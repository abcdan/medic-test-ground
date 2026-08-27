import { Money, sumOrZero } from "../money";
import type { Ledger } from "../ledger";
import { incomeStatement } from "./income-statement";

export interface BalanceSheetLine {
  code: string;
  name: string;
  amount: Money;
}

export interface BalanceSheet {
  asOf: string;
  assets: BalanceSheetLine[];
  totalAssets: Money;
  liabilities: BalanceSheetLine[];
  totalLiabilities: Money;
  equity: BalanceSheetLine[];
  totalEquity: Money;
  /** Assets - (liabilities + equity). Zero when the books are sound. */
  difference: Money;
  balanced: boolean;
}

const EPOCH = "1900-01-01";

/**
 * Snapshot of the books at a date. Retained earnings picks up the profit
 * of the current year, which has not been closed out yet.
 */
export function balanceSheet(ledger: Ledger, asOf: string, fiscalYearStart?: string): BalanceSheet {
  const currencyCode = ledger.chart.functionalCurrency;
  const yearStart = fiscalYearStart ?? `${asOf.slice(0, 4)}-01-01`;

  const lineFor = (code: string, name: string): BalanceSheetLine => ({
    code,
    name,
    amount: ledger.balance(code, EPOCH, asOf).balance,
  });

  const assets = ledger.chart
    .list("asset")
    .map((a) => lineFor(a.code, a.name))
    .filter((l) => !l.amount.isZero());

  const liabilities = ledger.chart
    .list("liability")
    .map((a) => lineFor(a.code, a.name))
    .filter((l) => !l.amount.isZero());

  const equity = ledger.chart
    .list("equity")
    .map((a) => lineFor(a.code, a.name))
    .filter((l) => !l.amount.isZero());

  const currentYearProfit = incomeStatement(ledger, yearStart, asOf).netIncome;
  if (!currentYearProfit.isZero()) {
    equity.push({ code: "3900", name: "Current year result", amount: currentYearProfit });
  }

  const totalAssets = sumOrZero(assets.map((l) => l.amount), currencyCode);
  const totalLiabilities = sumOrZero(liabilities.map((l) => l.amount), currencyCode);
  const totalEquity = sumOrZero(equity.map((l) => l.amount), currencyCode);

  const difference = totalAssets.minus(totalLiabilities.plus(totalEquity));

  return {
    asOf,
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    totalEquity,
    difference,
    balanced: difference.isZero(),
  };
}
