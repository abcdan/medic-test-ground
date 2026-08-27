import test from "node:test";
import assert from "node:assert";
import { Money } from "../src/money";
import { RateTable, convert } from "../src/fx";
import { addVat, extractVat, assess, rateFor, isEu, looksLikeVatNumber } from "../src/tax/vat";

function table(): RateTable {
  const t = new RateTable();
  t.addAll([
    { base: "EUR", quote: "USD", rate: 1.1, asOf: "2026-01-01", source: "ecb" },
    { base: "EUR", quote: "USD", rate: 1.2, asOf: "2026-02-01", source: "ecb" },
    { base: "EUR", quote: "GBP", rate: 0.85, asOf: "2026-01-01", source: "ecb" },
  ]);
  return t;
}

test("looks up the rate for a date", () => {
  const t = table();
  assert.equal(t.lookup("EUR", "USD", "2026-01-15").rate, 1.1);
  assert.equal(t.lookup("EUR", "USD", "2026-03-01").rate, 1.2);
});

test("inverts a missing direction", () => {
  const t = table();
  assert.ok(Math.abs(t.lookup("USD", "EUR", "2026-01-15").rate - 1 / 1.1) < 1e-9);
});

test("converts amounts", () => {
  const t = table();
  const out = convert(Money.fromMajor(100, "EUR"), "USD", t, "2026-01-15");
  assert.equal(out.to.toMajor(), 110);
  assert.equal(out.to.currencyCode, "USD");
});

test("vat on top and backed out", () => {
  const net = Money.fromMajor(100, "EUR");
  assert.equal(addVat(net, 21).gross.toMajor(), 121);
  assert.equal(extractVat(Money.fromMajor(121, "EUR"), 21).net.toMajor(), 100);
});

test("rate lookup honours validFrom", () => {
  assert.equal(rateFor("NL", "standard", "2026-01-01"), 21);
  assert.equal(rateFor("NL", "reduced", "2026-01-01"), 9);
  assert.equal(rateFor("DE", "standard", "2026-01-01"), 19);
});

test("domestic sale carries local vat", () => {
  const out = assess(Money.fromMajor(1000, "EUR"), {
    supplierCountry: "NL",
    customerCountry: "NL",
    category: "standard",
    date: "2026-01-01",
  });
  assert.equal(out.vat.toMajor(), 210);
  assert.ok(!out.reverseCharge);
});

test("intra-eu b2b is reverse charged", () => {
  const out = assess(Money.fromMajor(1000, "EUR"), {
    supplierCountry: "NL",
    customerCountry: "DE",
    customerVatNumber: "DE123456789",
    category: "standard",
    date: "2026-01-01",
  });
  assert.ok(out.reverseCharge);
  assert.ok(out.vat.isZero());
});

test("export outside the eu is zero rated", () => {
  const out = assess(Money.fromMajor(1000, "EUR"), {
    supplierCountry: "NL",
    customerCountry: "US",
    category: "standard",
    date: "2026-01-01",
  });
  assert.ok(out.vat.isZero());
  assert.ok(!out.reverseCharge);
});

test("eu membership and vat number shape", () => {
  assert.ok(isEu("nl"));
  assert.ok(!isEu("US"));
  assert.ok(looksLikeVatNumber("NL123456789B01"));
  assert.ok(!looksLikeVatNumber("nope"));
});
