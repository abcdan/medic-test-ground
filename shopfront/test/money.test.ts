import test from "node:test";
import assert from "node:assert";
import * as M from "../src/domain/money";

test("constructs and formats", () => {
  assert.equal(M.fromMajor(12.34, "EUR").amount, 1234);
  assert.equal(M.fromMajor(500, "JPY").amount, 500);
  assert.equal(M.format(M.fromMajor(1234.5, "EUR")), "€1234.50");
  assert.equal(M.format(M.fromMajor(1234, "JPY")), "¥1234");
});

test("arithmetic", () => {
  const a = M.fromMajor(10, "EUR");
  const b = M.fromMajor(2.5, "EUR");
  assert.equal(M.add(a, b).amount, 1250);
  assert.equal(M.subtract(a, b).amount, 750);
  assert.equal(M.multiply(a, 3).amount, 3000);
  assert.equal(M.divide(a, 4).amount, 250);
});

test("rejects mixed currencies", () => {
  assert.throws(() => M.add(M.fromMajor(1, "EUR"), M.fromMajor(1, "USD")));
});

test("allocate sums back to the original", () => {
  const parts = M.allocate(M.money(100), 3);
  assert.deepEqual(parts.map((p) => p.amount), [34, 33, 33]);
  assert.equal(M.sumAll(parts).amount, 100);
});

test("allocateByWeight keeps the total", () => {
  const parts = M.allocateByWeight(M.money(1000), [1, 1, 2]);
  assert.equal(M.sumAll(parts).amount, 1000);
});

test("floorAtZero clamps a negative", () => {
  assert.equal(M.floorAtZero(M.money(-50)).amount, 0);
  assert.equal(M.floorAtZero(M.money(50)).amount, 50);
});

test("percentOf", () => {
  assert.equal(M.percentOf(M.money(10000), 21).amount, 2100);
});
