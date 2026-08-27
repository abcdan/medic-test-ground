import { Router } from "../router";
import { created, field, notFound, ok, optionalField, type Request } from "../middleware";
import type { Store } from "../../store/repositories";
import type { EventBus } from "../../events/bus";
import type { Gateway } from "../../domain/payment";
import {
  buildView,
  commitSession,
  setContact,
  setDelivery,
  setPayment,
  setShippingMethod,
  startSession,
} from "../../domain/checkout";
import { buildCartContext } from "./cart";
import { format } from "../../domain/money";

export function checkoutRoutes(store: Store, bus: EventBus, gateway: Gateway): Router {
  const router = new Router();

  const loadSession = (id: string) => {
    const session = store.checkouts.find(id);
    if (!session) throw notFound("Checkout");
    return session;
  };

  const loadCart = (cartId: string) => {
    const cart = store.carts.find(cartId);
    if (!cart) throw notFound("Cart");
    return cart;
  };

  router.post("/checkouts", (request: Request) => {
    const cart = loadCart(field<string>(request.body, "cartId"));
    const session = startSession(cart);
    store.checkouts.insert(session);

    bus.emit("checkout.started", { cartId: cart.id, sessionId: session.id }, request.correlationId);
    return created(buildView(session, cart, buildCartContext(store, cart)));
  });

  router.get("/checkouts/:id", (request: Request) => {
    const session = loadSession(request.query.id);
    const cart = loadCart(session.cartId);
    return ok(buildView(session, cart, buildCartContext(store, cart)));
  });

  router.post("/checkouts/:id/contact", (request: Request) => {
    const session = loadSession(request.query.id);
    setContact(session, field<string>(request.body, "email"), optionalField(request.body, "phone", null));
    const cart = loadCart(session.cartId);
    return ok(buildView(session, cart, buildCartContext(store, cart)));
  });

  router.post("/checkouts/:id/delivery", (request: Request) => {
    const session = loadSession(request.query.id);
    const body = request.body as Record<string, unknown>;

    setDelivery(session, body.shippingAddress as never, body.billingAddress as never);

    const cart = loadCart(session.cartId);
    if (session.shippingAddress) {
      cart.shippingAddress = {
        countryCode: session.shippingAddress.countryCode,
        regionCode: session.shippingAddress.regionCode,
        postalCode: session.shippingAddress.postalCode,
      };
    }

    return ok(buildView(session, cart, buildCartContext(store, cart)));
  });

  router.post("/checkouts/:id/shipping-method", (request: Request) => {
    const session = loadSession(request.query.id);
    const cart = loadCart(session.cartId);
    const ctx = buildCartContext(store, cart);

    setShippingMethod(session, field<string>(request.body, "methodId"), ctx.shippingQuotes);
    cart.selectedShippingMethodId = session.shippingMethodId;

    return ok(buildView(session, cart, ctx));
  });

  router.post("/checkouts/:id/payment", (request: Request) => {
    const session = loadSession(request.query.id);
    setPayment(session, field<string>(request.body, "paymentToken"));
    const cart = loadCart(session.cartId);
    return ok(buildView(session, cart, buildCartContext(store, cart)));
  });

  router.post("/checkouts/:id/complete", async (request: Request) => {
    const session = loadSession(request.query.id);
    const cart = loadCart(session.cartId);
    const ctx = buildCartContext(store, cart);

    const result = await commitSession(session, cart, ctx, gateway);

    store.orders.insert(result.order);
    for (const transaction of result.transactions) {
      store.transactions.insert(transaction);
    }
    store.carts.remove(cart.id);

    bus.emit("order.created", { order: result.order }, request.correlationId);
    bus.emit("checkout.completed", { order: result.order }, request.correlationId);

    if (result.order.paidTotal.amount > 0) {
      bus.emit(
        "order.paid",
        { order: result.order, transaction: result.transactions[result.transactions.length - 1] },
        request.correlationId,
      );
    }

    return created({
      order: {
        id: result.order.id,
        number: result.order.number,
        name: result.order.name,
        email: result.order.email,
        total: result.order.total,
        totalFormatted: format(result.order.total),
        status: result.order.status,
        paymentStatus: result.order.paymentStatus,
        lines: result.order.lines.map((line) => ({
          sku: line.sku,
          title: line.title,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
        })),
      },
      redirectUrl: `/orders/${result.order.id}/thank-you`,
    });
  });

  return router;
}
