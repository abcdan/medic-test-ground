import test from "node:test";
import assert from "node:assert";
import { Money, sum, sumOrZero } from "../src/money";

test("constructs from major and minor", () => {
  assert.equal(Money.fromMajor(12.34, "EUR").amount, 1234);
  assert.equal(Money.fromMinor(1234, "EUR").toMajor(), 12.34);
  assert.equal(Money.fromMajor(500, "JPY").amount, 500);
  assert.equal(Money.fromMajor(1.234, "KWD").amount, 1234);
});

test("parses strings", () => {
  assert.equal(Money.parse("1,234.56", "EUR").amount, 123456);
  assert.equal(Money.parse("-99.99", "USD").amount, -9999);
});

test("arithmetic", () => {
  const a = Money.fromMajor(10, "EUR");
  const b = Money.fromMajor(2.5, "EUR");
  assert.equal(a.plus(b).toMajor(), 12.5);
  assert.equal(a.minus(b).toMajor(), 7.5);
  assert.equal(a.times(3).toMajor(), 30);
  assert.equal(a.dividedBy(4).toMajor(), 2.5);
});

test("rejects mixed currencies", () => {
  assert.throws(() => Money.fromMajor(1, "EUR").plus(Money.fromMajor(1, "USD")));
});

test("allocate distributes the remainder", () => {
  const parts = Money.fromMinor(100, "EUR").allocate(3);
  assert.deepEqual(parts.map((p) => p.amount), [34, 33, 33]);
  assert.equal(sum(parts).amount, 100);
});

test("allocateByRatio keeps the total", () => {
  const parts = Money.fromMinor(1000, "EUR").allocateByRatio([1, 1, 2]);
  assert.equal(sum(parts).amount, 1000);
  assert.equal(parts[2].amount, 500);
});

test("formats with the right precision", () => {
  assert.equal(Money.fromMajor(1234.5, "EUR").toString(), "€1234.50");
  assert.equal(Money.fromMajor(1234, "JPY").toString(), "¥1234");
});

test("sumOrZero handles the empty case", () => {
  assert.ok(sumOrZero([], "EUR").isZero());
});
