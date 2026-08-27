import { randomUUID } from "node:crypto";
import { Router } from "../router";
import { badRequest, created, field, forbidden, notFound, ok, optionalField, unauthorized, type Actor, type Request } from "../middleware";
import type { Store } from "../../store/repositories";
import type { EventBus } from "../../events/bus";
import {
  addAddress,
  create as createCustomer,
  metricsFor,
  normaliseEmail,
  removeAddress,
  segmentOf,
  verifyPassword,
} from "../../domain/customer";
import { toAddress } from "../../domain/order";
import { request as requestReturn } from "../../domain/returns";
import { format } from "../../domain/money";

/** Customer accounts and self-service order history. */
export function accountRoutes(store: Store, bus: EventBus, sessions: Map<string, Actor>): Router {
  const router = new Router();

  const requireCustomer = (request: Request) => {
    const actor = request.actor;
    if (!actor || actor.kind !== "customer") throw unauthorized("Please sign in");
    const customer = store.customers.find(actor.id);
    if (!customer) throw notFound("Customer");
    return customer;
  };

  router.post("/account/register", (request: Request) => {
    const email = normaliseEmail(field<string>(request.body, "email"));

    if (store.customers.byEmail(email)) {
      throw badRequest(`An account already exists for ${email}`);
    }

    const customer = createCustomer({
      email,
      firstName: optionalField(request.body, "firstName", ""),
      lastName: optionalField(request.body, "lastName", ""),
      password: field<string>(request.body, "password"),
      acceptsEmailMarketing: optionalField(request.body, "acceptsEmailMarketing", false),
    });

    store.customers.insert(customer);
    bus.emit("customer.created", { customer }, request.correlationId);

    const token = randomUUID();
    sessions.set(token, { kind: "customer", id: customer.id, email: customer.email, scopes: ["account"] });

    return created({ token, customer: { id: customer.id, email: customer.email } });
  });

  router.post("/account/login", (request: Request) => {
    const email = normaliseEmail(field<string>(request.body, "email"));
    const password = field<string>(request.body, "password");

    const customer = store.customers.byEmail(email);
    if (!customer) throw unauthorized(`No account for ${email}`);
    if (!customer.passwordHash) throw unauthorized("That account has no password set");
    if (!verifyPassword(password, customer.passwordHash)) throw unauthorized("Wrong password");

    customer.lastLoginAt = new Date().toISOString();

    const token = randomUUID();
    sessions.set(token, { kind: "customer", id: customer.id, email: customer.email, scopes: ["account"] });

    return ok({ token, customer: { id: customer.id, email: customer.email, firstName: customer.firstName } });
  });

  router.post("/account/logout", (request: Request) => {
    const header = request.headers.authorization ?? "";
    sessions.delete(header.split(" ")[1] ?? "");
    return ok({ ok: true });
  });

  router.get("/account", (request: Request) => {
    const customer = requireCustomer(request);
    const orders = store.orders.byCustomer(customer.id);
    const metrics = metricsFor(customer, orders);

    return ok({
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        acceptsEmailMarketing: customer.acceptsEmailMarketing,
        addresses: customer.addresses,
        locale: customer.locale,
      },
      metrics,
      segment: segmentOf(metrics),
    });
  });

  router.patch("/account", (request: Request) => {
    const customer = requireCustomer(request);
    Object.assign(customer, request.body as object);
    customer.updatedAt = new Date().toISOString();
    bus.emit("customer.updated", { customer }, request.correlationId);
    return ok({ customer });
  });

  router.get("/account/orders", (request: Request) => {
    const customer = requireCustomer(request);

    return ok({
      orders: store.orders.byCustomer(customer.id).map((order) => ({
        id: order.id,
        name: order.name,
        createdAt: order.createdAt,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfilmentStatus: order.fulfilmentStatus,
        total: order.total,
        totalFormatted: format(order.total),
        itemCount: order.lines.reduce((n, line) => n + line.quantity, 0),
      })),
    });
  });

  router.get("/account/orders/:id", (request: Request) => {
    const order = store.orders.find(request.query.id);
    if (!order) throw notFound("Order");

    return ok({
      order,
      fulfilments: store.fulfilments.forOrder(order.id),
      returns: store.returns.forOrder(order.id),
    });
  });

  router.post("/account/orders/:id/returns", (request: Request) => {
    const customer = requireCustomer(request);
    const order = store.orders.find(request.query.id);
    if (!order) throw notFound("Order");
    if (order.customerId !== customer.id) throw forbidden("That is not your order");

    const returnRequest = requestReturn(
      order,
      { lines: field(request.body, "lines"), note: optionalField(request.body, "note", "") },
      new Date(),
    );

    store.returns.insert(returnRequest);
    bus.emit("return.requested", { request: returnRequest }, request.correlationId);

    return created({ return: returnRequest });
  });

  router.post("/account/addresses", (request: Request) => {
    const customer = requireCustomer(request);
    const saved = addAddress(
      customer,
      toAddress(request.body as never),
      optionalField(request.body, "label", "Home"),
      optionalField(request.body, "isDefault", false),
    );
    return created({ address: saved });
  });

  router.delete("/account/addresses/:id", (request: Request) => {
    const customer = requireCustomer(request);
    removeAddress(customer, request.query.id);
    return ok({ addresses: customer.addresses });
  });

  router.get("/account/export", (request: Request) => {
    const customer = requireCustomer(request);
    return ok({
      profile: customer,
      orders: store.orders.byCustomer(customer.id),
      exportedAt: new Date().toISOString(),
    });
  });

  return router;
}
