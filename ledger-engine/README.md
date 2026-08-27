# ledger-engine

Double-entry bookkeeping: money, a chart of accounts, journal entries,
periods, statutory reports, VAT, FX, invoicing, fixed assets, budgets,
bank reconciliation and an audit trail.

```ts
import { ChartOfAccounts, STANDARD_CHART, Ledger, Money, simpleEntry } from "./src";

const chart = new ChartOfAccounts("EUR");
chart.addAll(STANDARD_CHART);

const ledger = new Ledger(chart);
ledger.postEntry(
  simpleEntry("2026-01-05", "January rent", "6100", "1010", Money.fromMajor(1500, "EUR"), chart),
);

console.log(ledger.verify());              // { ok: true, ... }
console.log(ledger.balance("6100").balance.toString());
```

## Money

Amounts are integer minor units with the currency attached. Operations
between currencies throw rather than silently producing a wrong number.

```ts
Money.fromMajor(12.34, "EUR").amount     // 1234
Money.fromMajor(500, "JPY").amount       // 500  (exponent 0)
Money.fromMinor(100, "EUR").allocate(3)  // 34, 33, 33 - sums back to 100
```

## Chart of accounts

Five types (`asset`, `liability`, `equity`, `revenue`, `expense`) with
parents for roll-ups and a `contra` flag for accounts that sit against
their parent with the opposite normal balance. `STANDARD_CHART` is a
ready-made starting point.

## Journal and ledger

An entry is a set of postings that must balance. Nothing is edited after
the fact: a correction is a reversing entry. Periods are calendar months
and can be `open`, `closed` or `locked`; posting into a closed period
throws `PeriodClosedError`.

## Reports

| Function | Output |
| --- | --- |
| `trialBalance` | Every account with a debit or credit column, plus totals |
| `incomeStatement` | Revenue, expenses, gross profit, net income, margin |
| `balanceSheet` | Assets, liabilities, equity and the difference |
| `agingReport` | Open receivables/payables bucketed by age |
| `variance` | Budget against actual, with a favourable/adverse flag |

## Tax and FX

`assess()` decides what VAT applies to a sale: domestic rate, intra-EU
reverse charge for a B2B customer, or zero rated outside the EU.
`vatReturn()` rolls a set of breakdowns into return boxes.

`RateTable` holds dated FX rates and inverts a missing direction
automatically; `convert()` handles differing currency exponents and
`revaluationDelta()` gives the unrealised gain on a foreign balance.

## Sub-ledgers

- **Invoicing** — build, post, pay, void and write off sales invoices;
  posting an invoice hits receivables, revenue and VAT payable
- **Fixed assets** — straight line and reducing balance schedules, monthly
  depreciation journals, disposals with gain/loss
- **Reconciliation** — matches bank statement lines against bank account
  postings on amount, date proximity and description similarity
- **CSV import** — configurable column mapping, European or Anglo number
  formats, three date layouts, duplicate detection
- **Audit trail** — every entry hashed against its predecessor, so tampering
  breaks the chain

## Layout

```
src/money.ts          integer minor units, allocation, formatting
src/currency.ts       currency metadata and exponents
src/fx.ts             dated rate table and conversion
src/accounts.ts       chart of accounts, normal balances, roll-ups
src/journal.ts        entries, postings, balance validation, reversal
src/periods.ts        open / closed / locked accounting periods
src/ledger.ts         posting engine, balances, statements
src/closing.ts        period and year end closing
src/reports/          trial balance, P&L, balance sheet, aging
src/tax/vat.ts        rates, reverse charge, VAT return boxes
src/invoicing.ts      sales invoices and payment application
src/depreciation.ts   fixed asset register and schedules
src/budgets.ts        budgets and variance analysis
src/reconciliation.ts bank statement matching
src/import/csv.ts     bank CSV parsing
src/audit.ts          hash-chained audit trail
```

`npm test` builds with `strict: true` and runs 35 unit tests.
