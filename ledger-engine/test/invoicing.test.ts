import test from "node:test";
import assert from "node:assert";
import { Money } from "../src/money";
import { ChartOfAccounts, STANDARD_CHART } from "../src/accounts";
import { Ledger } from "../src/ledger";
import { InvoiceBook, lineNet, addDays } from "../src/invoicing";
import { AssetRegister } from "../src/depreciation";
import { Budget, variance } from "../src/budgets";
import { AuditTrail } from "../src/audit";
import { importStatement, splitRow, parseAmount } from "../src/import/csv";

function setup(): Ledger {
  const chart = new ChartOfAccounts("EUR");
  chart.addAll(STANDARD_CHART);
  return new Ledger(chart);
}

const eur = (n: number) => Money.fromMajor(n, "EUR");

test("line net applies quantity and discount", () => {
  const net = lineNet({
    description: "Consulting",
    quantity: 10,
    unitPrice: eur(100),
    discount: 0.1,
    revenueAccount: "4000",
    category: "standard",
  });
  assert.equal(net.toMajor(), 900);
});

test("addDays rolls the month", () => {
  assert.equal(addDays("2026-01-20", 30), "2026-02-19");
});

test("invoice posts to the ledger", () => {
  const ledger = setup();
  const book = new InvoiceBook(ledger, "NL");

  const invoice = book.create({
    customerId: "c1",
    customerName: "Acme BV",
    customerCountry: "NL",
    issueDate: "2026-04-01",
    lines: [
      {
        description: "Consulting",
        quantity: 10,
        unitPrice: eur(100),
        discount: 0,
        revenueAccount: "4000",
        category: "standard",
      },
    ],
  });

  assert.equal(invoice.net.toMajor(), 1000);
  assert.equal(invoice.vat.toMajor(), 210);
  assert.equal(invoice.gross.toMajor(), 1210);

  book.post(invoice.id);
  assert.equal(invoice.status, "sent");
  assert.equal(ledger.balance("1100").balance.toMajor(), 1210);
  assert.equal(ledger.balance("4000").balance.toMajor(), 1000);
  assert.ok(ledger.verify().ok);
});

test("payment settles an invoice", () => {
  const ledger = setup();
  const book = new InvoiceBook(ledger, "NL");
  const invoice = book.create({
    customerId: "c1",
    customerName: "Acme BV",
    customerCountry: "NL",
    issueDate: "2026-04-01",
    lines: [
      { description: "x", quantity: 1, unitPrice: eur(100), discount: 0, revenueAccount: "4000", category: "zero" },
    ],
  });
  book.post(invoice.id);
  book.pay(invoice.id, eur(100), "2026-04-15");

  assert.equal(invoice.status, "paid");
  assert.ok(book.outstanding(invoice.id).isZero());
});

test("straight line depreciation spreads evenly", () => {
  const ledger = setup();
  const register = new AssetRegister(ledger);
  const asset = register.add({
    code: "LAPTOP-1",
    description: "Laptop",
    cost: eur(2400),
    usefulLife: 24,
    acquiredOn: "2026-01-15",
  });

  const schedule = register.schedule(asset.id);
  assert.equal(schedule.length, 24);
  assert.equal(schedule[0].charge.toMajor(), 100);
  assert.equal(schedule[23].closingValue.toMajor(), 0);
});

test("budget variance", () => {
  const ledger = setup();
  const budget = new Budget("2026 opex", 2026);
  budget.setAnnual("6100", eur(12000));

  ledger.post({
    date: "2026-01-31",
    description: "Rent",
    postings: [
      { accountCode: "6100", amount: eur(1100), side: "debit" },
      { accountCode: "1010", amount: eur(1100), side: "credit" },
    ],
  });

  const report = variance(ledger, budget, "2026-01", "2026-01");
  assert.equal(report.rows[0].budget.toMajor(), 1000);
  assert.equal(report.rows[0].actual.toMajor(), 1100);
  assert.equal(report.rows[0].variance.toMajor(), -100);
});

test("audit chain verifies", () => {
  const ledger = setup();
  const trail = new AuditTrail();

  const a = ledger.post({
    date: "2026-01-02",
    description: "One",
    postings: [
      { accountCode: "6100", amount: eur(10), side: "debit" },
      { accountCode: "1010", amount: eur(10), side: "credit" },
    ],
  });
  trail.record(a, "cfo", "post");

  const b = ledger.post({
    date: "2026-01-03",
    description: "Two",
    postings: [
      { accountCode: "6100", amount: eur(20), side: "debit" },
      { accountCode: "1010", amount: eur(20), side: "credit" },
    ],
  });
  trail.record(b, "cfo", "post");

  assert.ok(trail.verify(ledger).ok);
});

test("csv splitting handles quotes", () => {
  assert.deepEqual(splitRow('a,"b,c",d', ","), ["a", "b,c", "d"]);
  assert.deepEqual(splitRow('a,"say ""hi""",c', ","), ["a", 'say "hi"', "c"]);
});

test("amount parsing", () => {
  assert.equal(parseAmount("1,234.56", false), 1234.56);
  assert.equal(parseAmount("1.234,56", true), 1234.56);
  assert.equal(parseAmount("-45.00", false), -45);
});

test("statement import", () => {
  const csv = [
    "Date,Description,Name,Amount",
    "2026-02-01,Invoice INV-00001,Acme BV,1210.00",
    "2026-02-03,Rent February,Landlord BV,-750.00",
  ].join("\n");

  const result = importStatement(csv);
  assert.equal(result.errors.length, 0);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].amount.toMajor(), 1210);
  assert.equal(result.lines[1].amount.toMajor(), -750);
});
