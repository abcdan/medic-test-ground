import test from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import * as M from "../src/domain/money";
import type { Order, OrderLine } from "../src/domain/order";
import { cancel, isFullyFulfilled, matchesFilter, metrics, recomputeStatuses, toAddress, unfulfilledQuantity } from "../src/domain/order";
import { create as createFulfilment, remainingLines, trackingUrlFor } from "../src/domain/fulfilment";
import { calculateRefund, request as requestReturn, returnableQuantity, withinReturnWindow } from "../src/domain/returns";
import { balance, earn, openAccount, pointsFor, progress, redeem, tierFor, TIERS } from "../src/domain/loyalty";
import { buildBatch, DEFAULT_MAPPING, isBalanced, orderToJournal } from "../src/integrations/accounting";
import { create as createCustomer } from "../src/domain/customer";

function line(quantity: number, unit: number): OrderLine {
  return {
    id: randomUUID(),
    variantId: randomUUID(),
    productId: randomUUID(),
    sku: "SKU-1",
    title: "Test product",
    variantTitle: "",
    quantity,
    unitPrice: M.money(unit),
    lineTotal: M.money(unit * quantity),
    discountTotal: M.zero(),
    taxTotal: M.zero(),
    fulfilledQuantity: 0,
    refundedQuantity: 0,
    requiresShipping: true,
    taxCode: "standard",
    properties: {},
  };
}

function order(lines: OrderLine[] = [line(2, 2500)]): Order {
  const subtotal = M.sumAll(lines.map((l) => l.lineTotal));

  return {
    id: randomUUID(),
    number: 1001,
    name: "#1001",
    cartId: randomUUID(),
    customerId: "cust-1",
    email: "sam@example.test",
    currency: "EUR",
    market: "NL",
    status: "open",
    paymentStatus: "paid",
    fulfilmentStatus: "unfulfilled",
    lines,
    subtotal,
    discountTotal: M.zero(),
    shippingTotal: M.money(495),
    taxTotal: M.money(1039),
    total: M.add(M.add(subtotal, M.money(495)), M.money(1039)),
    paidTotal: M.add(M.add(subtotal, M.money(495)), M.money(1039)),
    refundedTotal: M.zero(),
    shippingAddress: toAddress({ countryCode: "NL", city: "Amsterdam", postalCode: "1011AB", line1: "Damrak 1" }),
    billingAddress: null,
    shippingMethodName: "Standard",
    discountCodes: [],
    note: "",
    tags: [],
    cancelledAt: null,
    cancelReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
  };
}

test("fulfilling everything flips the status", () => {
  const o = order();
  createFulfilment(o, { locationId: "loc-1", lines: [{ orderLineId: o.lines[0].id, quantity: 2 }] });
  recomputeStatuses(o);

  assert.ok(isFullyFulfilled(o));
  assert.equal(o.fulfilmentStatus, "fulfilled");
});

test("a partial fulfilment leaves work behind", () => {
  const o = order();
  createFulfilment(o, { locationId: "loc-1", lines: [{ orderLineId: o.lines[0].id, quantity: 1 }] });
  recomputeStatuses(o);

  assert.equal(o.fulfilmentStatus, "unfulfilled");
  assert.equal(unfulfilledQuantity(o.lines[0]), 1);
  assert.equal(remainingLines(o).length, 1);
});

test("cannot ship more than was ordered", () => {
  const o = order();
  assert.throws(() =>
    createFulfilment(o, { locationId: "loc-1", lines: [{ orderLineId: o.lines[0].id, quantity: 5 }] }),
  );
});

test("tracking urls", () => {
  assert.match(trackingUrlFor("postnl", "3S123") ?? "", /postnl/);
  assert.equal(trackingUrlFor("pigeon", "3S123"), null);
});

test("cancelling a shipped order is refused", () => {
  const o = order();
  createFulfilment(o, { locationId: "loc-1", lines: [{ orderLineId: o.lines[0].id, quantity: 2 }] });
  recomputeStatuses(o);

  assert.throws(() => cancel(o, { reason: "changed mind", restock: true, refund: true }));
});

test("returns are limited to what shipped", () => {
  const o = order();
  assert.equal(returnableQuantity(o.lines[0]), 0);

  createFulfilment(o, { locationId: "loc-1", lines: [{ orderLineId: o.lines[0].id, quantity: 2 }] });
  assert.equal(returnableQuantity(o.lines[0]), 2);

  assert.throws(() =>
    requestReturn(o, { lines: [{ orderLineId: o.lines[0].id, quantity: 3, reason: "too-small" }] }, new Date()),
  );
});

test("refund is what the customer actually paid", () => {
  const o = order();
  createFulfilment(o, { locationId: "loc-1", lines: [{ orderLineId: o.lines[0].id, quantity: 2 }] });

  const r = requestReturn(o, { lines: [{ orderLineId: o.lines[0].id, quantity: 1, reason: "too-small" }] }, new Date());
  const refund = calculateRefund(o, r, "staff-1");

  assert.equal(refund.total.amount, 2500);
});

test("the return window closes", () => {
  const o = order();
  const later = new Date(Date.now() + 60 * 24 * 3600 * 1000);
  assert.ok(!withinReturnWindow(o, later));
});

test("order filters", () => {
  const o = order();
  assert.ok(matchesFilter(o, { status: "open" }));
  assert.ok(!matchesFilter(o, { status: "cancelled" }));
  assert.ok(matchesFilter(o, { email: "sam@example.test" }));
});

test("order metrics", () => {
  const summary = metrics([order(), order()], "EUR");
  assert.equal(summary.count, 2);
  assert.equal(summary.itemsPerOrder, 2);
});

test("loyalty tiers", () => {
  assert.equal(tierFor(M.money(0)).name, "bronze");
  assert.equal(tierFor(M.money(30_000)).name, "silver");
  assert.equal(tierFor(M.money(500_000)).name, "platinum");
});

test("earning and redeeming points", () => {
  const customer = createCustomer({ email: "sam@example.test" });
  const account = openAccount(customer);
  const o = order();

  const opening = balance(account);
  earn(account, o);

  assert.ok(balance(account) > opening);
  assert.equal(pointsFor(o, TIERS[0]), 500);

  redeem(account, 100, o.id);
  assert.equal(balance(account), opening + 500 - 100);

  assert.throws(() => redeem(account, 999_999, o.id));
});

test("tier progress", () => {
  const customer = createCustomer({ email: "sam@example.test" });
  const account = openAccount(customer);
  account.qualifyingSpend = M.money(10_000);

  const p = progress(account);
  assert.equal(p.current.name, "bronze");
  assert.equal(p.next?.name, "silver");
});

test("an order journal balances", () => {
  const o = order();
  const entry = orderToJournal(o, DEFAULT_MAPPING);
  assert.ok(isBalanced(entry), JSON.stringify(entry.lines, null, 2));
});

test("an export batch balances", () => {
  const batch = buildBatch([order()], [], [], DEFAULT_MAPPING, "1970-01-01", "2999-12-31", "EUR");
  assert.ok(batch.balanced);
});
