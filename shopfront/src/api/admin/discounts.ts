import { randomUUID } from "node:crypto";
import { Router } from "../router";
import { badRequest, created, field, noContent, notFound, ok, optionalField, type Request } from "../middleware";
import type { Store } from "../../store/repositories";
import { generateCodes, normaliseCode, type Promotion } from "../../domain/promotions";
import { discountUsage } from "../../analytics";
import { money } from "../../domain/money";

/** Admin discount and promotion management. */
export function adminDiscountRoutes(store: Store): Router {
  const router = new Router();

  router.get("/discounts", (request: Request) => {
    const activeOnly = request.query.active === "true";
    const all = store.promotions.all();

    return ok({
      discounts: (activeOnly ? all.filter((p) => p.active) : all).map((promotion) => ({
        id: promotion.id,
        code: promotion.code,
        title: promotion.title,
        type: promotion.type,
        target: promotion.target,
        value: promotion.value,
        active: promotion.active,
        combinable: promotion.combinable,
        usageCount: promotion.usageCount,
        usageLimit: promotion.usageLimit,
        startsAt: promotion.startsAt,
        endsAt: promotion.endsAt,
      })),
      total: all.length,
    });
  });

  router.post("/discounts", (request: Request) => {
    const body = request.body as Record<string, unknown>;
    const code = optionalField<string | null>(body, "code", null);

    if (code && store.promotions.first((p) => p.code === normaliseCode(code))) {
      throw badRequest(`A discount with code ${code} already exists`);
    }

    const promotion: Promotion = {
      id: randomUUID(),
      code: code ? normaliseCode(code) : null,
      title: field<string>(body, "title"),
      type: field(body, "type"),
      target: optionalField(body, "target", "order"),
      value: field<number>(body, "value"),
      currency: optionalField(body, "currency", "EUR"),
      conditions: {
        minimumSubtotal: optionalField(body, "minimumSubtotal", null),
        minimumQuantity: optionalField(body, "minimumQuantity", 0),
        productIds: optionalField(body, "productIds", []),
        collectionIds: optionalField(body, "collectionIds", []),
        customerGroups: optionalField(body, "customerGroups", []),
        firstOrderOnly: optionalField(body, "firstOrderOnly", false),
        markets: optionalField(body, "markets", []),
      },
      buyQuantity: optionalField(body, "buyQuantity", 0),
      getQuantity: optionalField(body, "getQuantity", 0),
      getDiscountPercent: optionalField(body, "getDiscountPercent", 100),
      combinable: optionalField(body, "combinable", false),
      usageLimit: optionalField(body, "usageLimit", null),
      perCustomerLimit: optionalField(body, "perCustomerLimit", null),
      usageCount: 0,
      startsAt: optionalField(body, "startsAt", new Date().toISOString().slice(0, 10)),
      endsAt: optionalField(body, "endsAt", null),
      active: optionalField(body, "active", true),
      priority: optionalField(body, "priority", 0),
    };

    store.promotions.insert(promotion);
    return created({ discount: promotion });
  });

  router.get("/discounts/:id", (request: Request) => {
    const promotion = store.promotions.find(request.query.id);
    if (!promotion) throw notFound("Discount");

    const orders = store.orders.where((order) => promotion.code !== null && order.discountCodes.includes(promotion.code));

    return ok({
      discount: promotion,
      orders: orders.length,
      revenue: orders.reduce((sum, order) => sum + order.total.amount, 0),
    });
  });

  router.patch("/discounts/:id", (request: Request) => {
    const promotion = store.promotions.find(request.query.id);
    if (!promotion) throw notFound("Discount");

    Object.assign(promotion, request.body as object);
    return ok({ discount: promotion });
  });

  router.delete("/discounts/:id", (request: Request) => {
    if (!store.promotions.remove(request.query.id)) throw notFound("Discount");
    return noContent();
  });

  router.post("/discounts/:id/deactivate", (request: Request) => {
    const promotion = store.promotions.find(request.query.id);
    if (!promotion) throw notFound("Discount");

    promotion.active = false;
    return ok({ discount: promotion });
  });

  /** Mint a batch of single-use codes sharing one promotion's terms. */
  router.post("/discounts/:id/codes", (request: Request) => {
    const template = store.promotions.find(request.query.id);
    if (!template) throw notFound("Discount");

    const count = optionalField(request.body, "count", 10);
    const prefix = optionalField(request.body, "prefix", "");

    const codes = generateCodes(prefix, count);
    const created_: Promotion[] = [];

    for (const code of codes) {
      const clone: Promotion = {
        ...template,
        id: randomUUID(),
        code,
        usageCount: 0,
        perCustomerLimit: 1,
        usageLimit: 1,
      };
      store.promotions.insert(clone);
      created_.push(clone);
    }

    return created({ codes: created_.map((p) => p.code) });
  });

  router.get("/discounts/reports/usage", () =>
    ok({ rows: discountUsage(store.orders.all(), "EUR") }),
  );

  /** Preview what a discount would take off a hypothetical basket. */
  router.post("/discounts/:id/preview", (request: Request) => {
    const promotion = store.promotions.find(request.query.id);
    if (!promotion) throw notFound("Discount");

    const subtotal = money(field<number>(request.body, "subtotalMinor"));

    return ok({
      subtotal,
      estimatedDiscount:
        promotion.type === "percentage"
          ? money(Math.round((subtotal.amount * promotion.value) / 100))
          : money(promotion.value),
    });
  });

  return router;
}
