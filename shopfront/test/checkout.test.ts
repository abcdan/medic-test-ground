import test from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import * as M from "../src/domain/money";
import { addLine, createCart, type CartContext } from "../src/domain/cart";
import {
  commitSession,
  setContact,
  setDelivery,
  setPayment,
  setShippingMethod,
  startSession,
  validateAddress,
} from "../src/domain/checkout";
import { toAddress } from "../src/domain/order";
import { SandboxGateway } from "../src/domain/payment";
import { DEFAULT_RATES, DEFAULT_TAX_SETTINGS } from "../src/domain/tax";
import type { Variant } from "../src/domain/catalog";

function variant(price: number): Variant {
  return {
    id: randomUUID(),
    productId: randomUUID(),
    sku: "TEST-1",
    barcode: null,
    optionValues: [],
    price: M.money(price),
    compareAtPrice: null,
    costPrice: null,
    weightGrams: 300,
    lengthMm: 100,
    widthMm: 80,
    heightMm: 40,
    requiresShipping: true,
    taxCode: "standard",
    imageIds: [],
    position: 0,
    active: true,
  };
}

const ADDRESS = {
  firstName: "Sam",
  lastName: "de Vries",
  line1: "Keizersgracht 1",
  city: "Amsterdam",
  postalCode: "1015 CJ",
  countryCode: "NL",
};

function context(variants: Variant[]): CartContext {
  return {
    variants: new Map(variants.map((v) => [v.id, v])),
    priceLists: [],
    promotions: [],
    taxRates: DEFAULT_RATES,
    taxSettings: DEFAULT_TAX_SETTINGS,
    shippingQuotes: [
      { methodId: "standard", name: "Standard", description: "2-3 days", price: M.money(495), estimatedDays: { min: 2, max: 3 }, free: false },
    ],
    inventory: new Map(),
    tracking: new Map(),
    customerGroups: [],
    isFirstOrder: true,
    redemptions: new Map(),
    giftCardBalances: new Map(),
    now: () => new Date().toISOString(),
  };
}

test("address validation catches missing fields", () => {
  assert.deepEqual(validateAddress(toAddress({})), [
    "firstName",
    "lastName",
    "line1",
    "city",
    "postalCode",
    "countryCode",
  ]);
  assert.deepEqual(validateAddress(toAddress(ADDRESS)), []);
});

test("US addresses need a region", () => {
  const missing = validateAddress(toAddress({ ...ADDRESS, countryCode: "US" }));
  assert.ok(missing.includes("regionCode"));
});

test("rejects a bad email", () => {
  const cart = createCart();
  const session = startSession(cart);
  assert.throws(() => setContact(session, "not-an-email", null));
});

test("walks the whole checkout", async () => {
  const v = variant(2500);
  const ctx = context([v]);
  const cart = createCart();
  addLine(cart, { variantId: v.id, quantity: 2 }, ctx);

  const session = startSession(cart);
  setContact(session, "sam@example.test", null);
  setDelivery(session, ADDRESS);
  setShippingMethod(session, "standard", ctx.shippingQuotes);
  setPayment(session, "tok_visa_4242");

  const result = await commitSession(session, cart, ctx, new SandboxGateway());

  assert.equal(result.order.status, "open");
  assert.equal(result.order.paymentStatus, "paid");
  assert.equal(result.order.lines.length, 1);
  assert.equal(result.order.lines[0].quantity, 2);
  assert.equal(session.step, "complete");
});

test("a declined card fails the checkout", async () => {
  const v = variant(2500);
  const ctx = context([v]);
  const cart = createCart();
  addLine(cart, { variantId: v.id, quantity: 1 }, ctx);

  const session = startSession(cart);
  setContact(session, "sam@example.test", null);
  setDelivery(session, ADDRESS);
  setShippingMethod(session, "standard", ctx.shippingQuotes);
  setPayment(session, "tok_declined_0002");

  await assert.rejects(() => commitSession(session, cart, ctx, new SandboxGateway()));
});

test("a completed session cannot be replayed", async () => {
  const v = variant(1000);
  const ctx = context([v]);
  const cart = createCart();
  addLine(cart, { variantId: v.id, quantity: 1 }, ctx);

  const session = startSession(cart);
  setContact(session, "sam@example.test", null);
  setDelivery(session, ADDRESS);
  setShippingMethod(session, "standard", ctx.shippingQuotes);
  setPayment(session, "tok_ok");

  await commitSession(session, cart, ctx, new SandboxGateway());
  await assert.rejects(() => commitSession(session, cart, ctx, new SandboxGateway()));
});
