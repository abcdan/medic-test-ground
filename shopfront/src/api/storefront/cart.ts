import { Router } from "../router";
import { badRequest, created, field, notFound, ok, optionalField, type Request } from "../middleware";
import type { Store } from "../../store/repositories";
import {
  addLine,
  applyDiscountCode,
  clearCart,
  computeTotals,
  createCart,
  mergeCarts,
  removeDiscountCode,
  removeLine,
  updateLineQuantity,
  validateCart,
  type Cart,
  type CartContext,
} from "../../domain/cart";
import { format } from "../../domain/money";
import { quote as quoteShipping } from "../../domain/shipping";
import { DEFAULT_TAX_SETTINGS } from "../../domain/tax";
import type { EventBus } from "../../events/bus";

/** Build the context the cart maths needs from the current store state. */
export function buildCartContext(store: Store, cart: Cart): CartContext {
  const parcel = {
    weightGrams: cart.lines.reduce((n, line) => n + line.weightGrams * line.quantity, 0),
    itemCount: cart.lines.reduce((n, line) => n + line.quantity, 0),
    value: { amount: cart.lines.reduce((n, l) => n + l.unitPrice.amount * l.quantity, 0), currency: cart.currency },
    hasDigitalOnly: cart.lines.every((line) => !line.requiresShipping),
  };

  const destination = cart.shippingAddress ?? { countryCode: "NL", regionCode: "", postalCode: "" };

  return {
    variants: store.variants.asMap(),
    priceLists: store.priceLists.all(),
    promotions: store.promotions.all(),
    taxRates: store.taxRates.all(),
    taxSettings: DEFAULT_TAX_SETTINGS,
    shippingQuotes: quoteShipping(store.zones.all(), store.shippingMethods.all(), destination, parcel),
    inventory: store.inventory.asMap(),
    tracking: store.inventory.trackingMap(),
    customerGroups: [],
    isFirstOrder: true,
    redemptions: new Map(),
    giftCardBalances: new Map(),
    now: () => new Date().toISOString(),
  };
}

function serialise(cart: Cart, store: Store) {
  const ctx = buildCartContext(store, cart);
  const totals = computeTotals(cart, ctx);

  return {
    id: cart.id,
    token: cart.token,
    currency: cart.currency,
    lines: cart.lines.map((line) => ({
      id: line.id,
      variantId: line.variantId,
      sku: line.sku,
      title: line.title,
      variantTitle: line.variantTitle,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitPriceFormatted: format(line.unitPrice),
      lineTotal: { amount: line.unitPrice.amount * line.quantity, currency: cart.currency },
      properties: line.properties,
      discount: totals.discounts.lineDiscounts.get(line.id) ?? null,
    })),
    itemCount: totals.itemCount,
    totals: {
      subtotal: totals.subtotal,
      discount: totals.orderDiscount,
      shipping: totals.shipping,
      tax: totals.tax,
      total: totals.total,
      totalFormatted: format(totals.total),
    },
    discountCodes: cart.discountCodes,
    appliedDiscounts: totals.discounts.applied.map((d) => ({ code: d.code, title: d.title, amount: d.amount })),
    rejectedDiscounts: totals.discounts.rejected,
    shippingQuotes: ctx.shippingQuotes,
    problems: validateCart(cart, ctx),
  };
}

export function cartRoutes(store: Store, bus: EventBus): Router {
  const router = new Router();

  const load = (token: string): Cart => {
    const cart = store.carts.byToken(token);
    if (!cart) throw notFound("Cart");
    return cart;
  };

  router.post("/carts", (request: Request) => {
    const cart = createCart(
      optionalField(request.body, "currency", "EUR"),
      optionalField(request.body, "market", "NL"),
    );
    store.carts.insert(cart);
    bus.emit("cart.created", { cart }, request.correlationId);
    return created(serialise(cart, store));
  });

  router.get("/carts/:token", (request: Request) => ok(serialise(load(request.query.token), store)));

  router.post("/carts/:token/lines", (request: Request) => {
    const cart = load(request.query.token);
    const ctx = buildCartContext(store, cart);

    addLine(
      cart,
      {
        variantId: field<string>(request.body, "variantId"),
        quantity: optionalField(request.body, "quantity", 1),
        properties: optionalField(request.body, "properties", {}),
      },
      ctx,
    );

    bus.emit("cart.updated", { cart }, request.correlationId);
    return ok(serialise(cart, store));
  });

  router.patch("/carts/:token/lines/:lineId", (request: Request) => {
    const cart = load(request.query.token);
    const ctx = buildCartContext(store, cart);
    const quantity = field<number>(request.body, "quantity");

    updateLineQuantity(cart, request.query.lineId, quantity, ctx);
    bus.emit("cart.updated", { cart }, request.correlationId);
    return ok(serialise(cart, store));
  });

  router.delete("/carts/:token/lines/:lineId", (request: Request) => {
    const cart = load(request.query.token);
    removeLine(cart, request.query.lineId, buildCartContext(store, cart));
    bus.emit("cart.updated", { cart }, request.correlationId);
    return ok(serialise(cart, store));
  });

  router.delete("/carts/:token/lines", (request: Request) => {
    const cart = load(request.query.token);
    clearCart(cart, buildCartContext(store, cart));
    return ok(serialise(cart, store));
  });

  router.post("/carts/:token/discounts", (request: Request) => {
    const cart = load(request.query.token);
    const code = field<string>(request.body, "code");
    applyDiscountCode(cart, code, buildCartContext(store, cart));
    return ok(serialise(cart, store));
  });

  router.delete("/carts/:token/discounts/:code", (request: Request) => {
    const cart = load(request.query.token);
    removeDiscountCode(cart, request.query.code, buildCartContext(store, cart));
    return ok(serialise(cart, store));
  });

  router.post("/carts/:token/address", (request: Request) => {
    const cart = load(request.query.token);

    cart.shippingAddress = {
      countryCode: field<string>(request.body, "countryCode"),
      regionCode: optionalField(request.body, "regionCode", ""),
      postalCode: optionalField(request.body, "postalCode", ""),
    };

    return ok(serialise(cart, store));
  });

  router.post("/carts/:token/shipping-method", (request: Request) => {
    const cart = load(request.query.token);
    cart.selectedShippingMethodId = field<string>(request.body, "methodId");
    return ok(serialise(cart, store));
  });

  router.post("/carts/:token/merge", (request: Request) => {
    const target = load(request.query.token);
    const source = store.carts.byToken(field<string>(request.body, "sourceToken"));
    if (!source) throw badRequest("No such source cart");

    mergeCarts(target, source, buildCartContext(store, target));
    store.carts.remove(source.id);
    return ok(serialise(target, store));
  });

  return router;
}
