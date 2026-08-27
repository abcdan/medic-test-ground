import test from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import * as M from "../src/domain/money";
import { createStore } from "../src/store/repositories";
import { addLine, computeTotals, createCart, updateLineQuantity, type CartContext } from "../src/domain/cart";
import { DEFAULT_TAX_SETTINGS, DEFAULT_RATES } from "../src/domain/tax";
import type { Variant } from "../src/domain/catalog";

function variant(price: number, sku = "SKU-1"): Variant {
  return {
    id: randomUUID(),
    productId: randomUUID(),
    sku,
    barcode: null,
    optionValues: [],
    price: M.money(price),
    compareAtPrice: null,
    costPrice: null,
    weightGrams: 500,
    lengthMm: 100,
    widthMm: 100,
    heightMm: 50,
    requiresShipping: true,
    taxCode: "standard",
    imageIds: [],
    position: 0,
    active: true,
  };
}

function context(variants: Variant[]): CartContext {
  return {
    variants: new Map(variants.map((v) => [v.id, v])),
    priceLists: [],
    promotions: [],
    taxRates: DEFAULT_RATES,
    taxSettings: DEFAULT_TAX_SETTINGS,
    shippingQuotes: [],
    inventory: new Map(),
    tracking: new Map(),
    customerGroups: [],
    isFirstOrder: true,
    redemptions: new Map(),
    giftCardBalances: new Map(),
    now: () => new Date().toISOString(),
  };
}

test("adds and merges lines", () => {
  const v = variant(1999);
  const ctx = context([v]);
  const cart = createCart();

  addLine(cart, { variantId: v.id, quantity: 2 }, ctx);
  addLine(cart, { variantId: v.id, quantity: 1 }, ctx);

  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].quantity, 3);
});

test("keeps lines with different properties apart", () => {
  const v = variant(1999);
  const ctx = context([v]);
  const cart = createCart();

  addLine(cart, { variantId: v.id, quantity: 1, properties: { engraving: "A" } }, ctx);
  addLine(cart, { variantId: v.id, quantity: 1, properties: { engraving: "B" } }, ctx);

  assert.equal(cart.lines.length, 2);
});

test("computes a subtotal", () => {
  const a = variant(1000, "A");
  const b = variant(2550, "B");
  const ctx = context([a, b]);
  const cart = createCart();

  addLine(cart, { variantId: a.id, quantity: 2 }, ctx);
  addLine(cart, { variantId: b.id, quantity: 1 }, ctx);

  const totals = computeTotals(cart, ctx);
  assert.equal(totals.subtotal.amount, 4550);
  assert.equal(totals.itemCount, 3);
});

test("setting a quantity to zero removes the line", () => {
  const v = variant(500);
  const ctx = context([v]);
  const cart = createCart();

  addLine(cart, { variantId: v.id, quantity: 3 }, ctx);
  updateLineQuantity(cart, cart.lines[0].id, 0, ctx);

  assert.equal(cart.lines.length, 0);
});

test("rejects an unknown variant", () => {
  const ctx = context([]);
  assert.throws(() => addLine(createCart(), { variantId: "nope", quantity: 1 }, ctx));
});

test("charges tax on a Dutch address", () => {
  const v = variant(12100);
  const ctx = context([v]);
  const cart = createCart();
  cart.shippingAddress = { countryCode: "NL", regionCode: "", postalCode: "1011AB" };

  addLine(cart, { variantId: v.id, quantity: 1 }, ctx);
  const totals = computeTotals(cart, ctx);

  assert.equal(totals.tax.amount, 2100);
  assert.equal(totals.total.amount, 12100);
});
