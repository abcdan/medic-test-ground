import { Money, sumOrZero } from "./money";
import type { Ledger } from "./ledger";
import type { PostingInput } from "./journal";
import { periodEnd, periodIdFor } from "./periods";
import { incomeStatement } from "./reports/income-statement";

/**
 * Period and year end closing.
 *
 * Closing the year rolls every revenue and expense account back to zero
 * and books the net result into retained earnings.
 */

export interface ClosingResult {
  periodId: string;
  entryId: string | null;
  netIncome: Money;
  accountsClosed: number;
}

const RETAINED_EARNINGS = "3100";

/** Close a month: freeze it so nothing else can be posted into it. */
export function closePeriod(ledger: Ledger, periodId: string, by: string): ClosingResult {
  const from = `${periodId}-01`;
  const to = periodEnd(periodId);
  const result = incomeStatement(ledger, from, to);

  ledger.periods.close(periodId, by);

  return {
    periodId,
    entryId: null,
    netIncome: result.netIncome,
    accountsClosed: 0,
  };
}

/**
 * Close a fiscal year: zero out the P&L accounts against retained
 * earnings, then close every period in the year.
 */
export function closeYear(ledger: Ledger, year: number, by: string): ClosingResult {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const currencyCode = ledger.chart.functionalCurrency;

  const postings: PostingInput[] = [];

  for (const account of [...ledger.chart.list("revenue"), ...ledger.chart.list("expense")]) {
    const balance = ledger.balance(account.code, from, to).balance;
    if (balance.isZero()) continue;

    const normal = ledger.chart.normalBalance(account.code);
    postings.push({
      accountCode: account.code,
      amount: balance.abs(),
      side: normal === "debit" ? "credit" : "debit",
      memo: `Year end close ${year}`,
    });
  }

  if (postings.length === 0) {
    return { periodId: `${year}-12`, entryId: null, netIncome: Money.zero(currencyCode), accountsClosed: 0 };
  }

  const debits = sumOrZero(postings.filter((p) => p.side === "debit").map((p) => p.amount), currencyCode);
  const credits = sumOrZero(postings.filter((p) => p.side === "credit").map((p) => p.amount), currencyCode);
  const netIncome = credits.minus(debits);

  postings.push({
    accountCode: RETAINED_EARNINGS,
    amount: netIncome.abs(),
    side: netIncome.isPositive() ? "credit" : "debit",
    memo: `Result ${year}`,
  });

  const entry = ledger.post({
    date: to,
    description: `Year end closing ${year}`,
    reference: `CLOSE-${year}`,
    postings,
  });

  for (let month = 1; month <= 12; month++) {
    ledger.periods.close(`${year}-${String(month).padStart(2, "0")}`, by);
  }

  return {
    periodId: periodIdFor(to),
    entryId: entry.id,
    netIncome,
    accountsClosed: postings.length - 1,
  };
}

/** Opening balances for the next year, carried from the balance sheet. */
export function openingBalances(ledger: Ledger, year: number): PostingInput[] {
  const asOf = `${year - 1}-12-31`;
  const postings: PostingInput[] = [];

  for (const account of ledger.chart.list()) {
    if (!ledger.chart.isBalanceSheet(account.code)) continue;

    const balance = ledger.balance(account.code, "1900-01-01", asOf).balance;
    if (balance.isZero()) continue;

    const normal = ledger.chart.normalBalance(account.code);
    postings.push({
      accountCode: account.code,
      amount: balance.abs(),
      side: normal,
      memo: `Opening balance ${year}`,
    });
  }

  return postings;
}
