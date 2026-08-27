import test from "node:test";
import assert from "node:assert";
import * as M from "../src/domain/money";
import {
  applyPromotions,
  checkEligibility,
  computeDiscount,
  generateCodes,
  normaliseCode,
  type DiscountContext,
  type Promotion,
} from "../src/domain/promotions";

function line(id: string, unit: number, quantity: number) {
  return {
    id,
    variantId: `v-${id}`,
    productId: `p-${id}`,
    collectionIds: [],
    quantity,
    unitPrice: M.money(unit),
    lineTotal: M.money(unit * quantity),
  };
}

function promotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: "promo-1",
    code: "SAVE10",
    title: "10% off",
    type: "percentage",
    target: "order",
    value: 10,
    currency: "EUR",
    conditions: {
      minimumSubtotal: null,
      minimumQuantity: 0,
      productIds: [],
      collectionIds: [],
      customerGroups: [],
      firstOrderOnly: false,
      markets: [],
    },
    buyQuantity: 0,
    getQuantity: 0,
    getDiscountPercent: 100,
    combinable: true,
    usageLimit: null,
    perCustomerLimit: null,
    usageCount: 0,
    startsAt: "2020-01-01",
    endsAt: null,
    active: true,
    priority: 0,
    ...overrides,
  };
}

function context(lines = [line("a", 1000, 2)]): DiscountContext {
  return {
    lines,
    subtotal: M.sumAll(lines.map((l) => l.lineTotal)),
    shippingTotal: M.money(495),
    customerId: "c1",
    customerGroups: [],
    market: "NL",
    isFirstOrder: false,
    at: "2026-06-01",
    redemptions: new Map(),
  };
}

test("percentage discount", () => {
  const applied = computeDiscount(promotion(), context());
  assert.equal(applied.amount.amount, 200);
});

test("fixed amount is spread across lines", () => {
  const lines = [line("a", 1000, 1), line("b", 3000, 1)];
  const applied = computeDiscount(promotion({ type: "fixed-amount", value: 400 }), context(lines));
  assert.equal(applied.amount.amount, 400);
  assert.equal(applied.lineAmounts.get("a")?.amount, 100);
  assert.equal(applied.lineAmounts.get("b")?.amount, 300);
});

test("expired promotions are rejected", () => {
  const reason = checkEligibility(promotion({ endsAt: "2025-01-01" }), context());
  assert.match(reason ?? "", /expired/);
});

test("minimum subtotal is enforced", () => {
  const reason = checkEligibility(
    promotion({ conditions: { ...promotion().conditions, minimumSubtotal: M.money(5000) } }),
    context(),
  );
  assert.match(reason ?? "", /below the minimum/);
});

test("usage limits are enforced", () => {
  const reason = checkEligibility(promotion({ usageLimit: 5, usageCount: 5 }), context());
  assert.match(reason ?? "", /fully redeemed/);
});

test("combinable promotions stack", () => {
  const result = applyPromotions(
    [promotion({ id: "a", code: "A" }), promotion({ id: "b", code: "B", value: 5 })],
    context(),
  );
  assert.equal(result.applied.length, 2);
  assert.equal(result.orderDiscount.amount, 300);
});

test("free shipping targets shipping", () => {
  const result = applyPromotions(
    [promotion({ type: "free-shipping", target: "shipping" })],
    context(),
  );
  assert.equal(result.shippingDiscount.amount, 495);
  assert.equal(result.orderDiscount.amount, 0);
});

test("code normalisation and generation", () => {
  assert.equal(normaliseCode(" save-10 "), "SAVE10");
  const codes = generateCodes("SUMMER", 5);
  assert.equal(codes.length, 5);
  assert.ok(codes.every((code) => code.startsWith("SUMMER")));
});
