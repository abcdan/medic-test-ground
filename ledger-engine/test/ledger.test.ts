import test from "node:test";
import assert from "node:assert";
import { Money } from "../src/money";
import { ChartOfAccounts, STANDARD_CHART } from "../src/accounts";
import { Ledger } from "../src/ledger";
import { simpleEntry, draft } from "../src/journal";
import { trialBalance } from "../src/reports/trial-balance";
import { incomeStatement } from "../src/reports/income-statement";
import { PeriodClosedError } from "../src/periods";

function setup(): Ledger {
  const chart = new ChartOfAccounts("EUR");
  chart.addAll(STANDARD_CHART);
  return new Ledger(chart);
}

const eur = (n: number) => Money.fromMajor(n, "EUR");

test("posts a balanced entry", () => {
  const ledger = setup();
  const entry = ledger.post({
    date: "2026-03-01",
    description: "Software subscription",
    postings: [
      { accountCode: "6200", amount: eur(100), side: "debit" },
      { accountCode: "1010", amount: eur(100), side: "credit" },
    ],
  });

  assert.equal(entry.status, "posted");
  assert.equal(entry.number, 1);
  assert.equal(ledger.balance("6200").balance.toMajor(), 100);
  assert.equal(ledger.balance("1010").balance.toMajor(), -100);
});

test("rejects an unbalanced entry", () => {
  const ledger = setup();
  assert.throws(() =>
    ledger.post({
      date: "2026-03-01",
      description: "Oops",
      postings: [
        { accountCode: "6200", amount: eur(100), side: "debit" },
        { accountCode: "1010", amount: eur(90), side: "credit" },
      ],
    }),
  );
});

test("the whole ledger balances", () => {
  const ledger = setup();
  ledger.postEntry(simpleEntry("2026-01-05", "Sale", "1100", "4000", eur(1000), ledger.chart));
  ledger.postEntry(simpleEntry("2026-01-06", "Rent", "6100", "1010", eur(750), ledger.chart));
  ledger.postEntry(simpleEntry("2026-01-07", "Payment received", "1010", "1100", eur(1000), ledger.chart));

  const check = ledger.verify();
  assert.ok(check.ok, `difference ${check.difference.toString()}`);
});

test("reversal cancels an entry out", () => {
  const ledger = setup();
  const entry = ledger.postEntry(simpleEntry("2026-02-01", "Mistake", "6100", "1010", eur(500), ledger.chart));
  ledger.reverseEntry(entry.id, "2026-02-02");

  assert.equal(ledger.balance("6100").balance.toMajor(), 0);
  assert.equal(ledger.get(entry.id)?.status, "reversed");
});

test("trial balance agrees", () => {
  const ledger = setup();
  ledger.postEntry(simpleEntry("2026-01-05", "Sale", "1100", "4000", eur(2500), ledger.chart));
  ledger.postEntry(simpleEntry("2026-01-09", "Salary", "6000", "1010", eur(1800), ledger.chart));

  const tb = trialBalance(ledger, "2026-01-01", "2026-01-31");
  assert.ok(tb.balanced, `${tb.totalDebit.toString()} vs ${tb.totalCredit.toString()}`);
});

test("income statement nets revenue against expenses", () => {
  const ledger = setup();
  ledger.postEntry(simpleEntry("2026-01-05", "Sale", "1100", "4000", eur(5000), ledger.chart));
  ledger.postEntry(simpleEntry("2026-01-06", "COGS", "5000", "1200", eur(2000), ledger.chart));
  ledger.postEntry(simpleEntry("2026-01-07", "Rent", "6100", "1010", eur(1000), ledger.chart));

  const pnl = incomeStatement(ledger, "2026-01-01", "2026-01-31");
  assert.equal(pnl.totalRevenue.toMajor(), 5000);
  assert.equal(pnl.totalExpenses.toMajor(), 3000);
  assert.equal(pnl.netIncome.toMajor(), 2000);
});

test("closed periods reject postings", () => {
  const ledger = setup();
  ledger.periods.close("2026-01", "cfo");
  assert.throws(
    () => ledger.postEntry(simpleEntry("2026-01-15", "Late", "6100", "1010", eur(10), ledger.chart)),
    PeriodClosedError,
  );
});

test("statement shows a running balance", () => {
  const ledger = setup();
  ledger.postEntry(simpleEntry("2026-01-05", "In", "1010", "4000", eur(100), ledger.chart));
  ledger.postEntry(simpleEntry("2026-01-06", "Out", "6100", "1010", eur(40), ledger.chart));

  const lines = ledger.statement("1010");
  assert.equal(lines.length, 2);
  assert.equal(lines[1].runningBalance.toMajor(), 60);
});
