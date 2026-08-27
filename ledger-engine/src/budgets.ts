import { Money, sumOrZero } from "./money";
import type { Ledger } from "./ledger";
import { periodEnd } from "./periods";

/**
 * Budgets and variance reporting.
 *
 * A budget holds a figure per account per period. Variance compares it
 * against what actually landed in the ledger.
 */

export interface BudgetLine {
  accountCode: string;
  periodId: string;
  amount: Money;
}

export interface VarianceRow {
  accountCode: string;
  accountName: string;
  budget: Money;
  actual: Money;
  variance: Money;
  variancePercent: number;
  favourable: boolean;
}

export interface VarianceReport {
  from: string;
  to: string;
  rows: VarianceRow[];
  totalBudget: Money;
  totalActual: Money;
  totalVariance: Money;
}

export class Budget {
  private lines = new Map<string, BudgetLine>();

  constructor(
    readonly name: string,
    readonly year: number,
    readonly currencyCode = "EUR",
  ) {}

  private static key(accountCode: string, periodId: string): string {
    return `${accountCode}@${periodId}`;
  }

  set(accountCode: string, periodId: string, amount: Money): void {
    this.lines.set(Budget.key(accountCode, periodId), { accountCode, periodId, amount });
  }

  /** Spread an annual figure evenly across twelve months. */
  setAnnual(accountCode: string, amount: Money): void {
    const monthly = amount.allocate(12);
    for (let month = 1; month <= 12; month++) {
      this.set(accountCode, `${this.year}-${String(month).padStart(2, "0")}`, monthly[month - 1]);
    }
  }

  get(accountCode: string, periodId: string): Money {
    return this.lines.get(Budget.key(accountCode, periodId))?.amount ?? Money.zero(this.currencyCode);
  }

  /** Budget for an account across a range of periods. */
  range(accountCode: string, fromPeriod: string, toPeriod: string): Money {
    const matching = [...this.lines.values()].filter(
      (l) => l.accountCode === accountCode && l.periodId >= fromPeriod && l.periodId <= toPeriod,
    );
    return sumOrZero(matching.map((l) => l.amount), this.currencyCode);
  }

  accounts(): string[] {
    return [...new Set([...this.lines.values()].map((l) => l.accountCode))].sort();
  }

  all(): BudgetLine[] {
    return [...this.lines.values()];
  }
}

/** Compare a budget against the ledger over a period range. */
export function variance(ledger: Ledger, budget: Budget, fromPeriod: string, toPeriod: string): VarianceReport {
  const currencyCode = budget.currencyCode;
  const from = `${fromPeriod}-01`;
  const to = periodEnd(toPeriod);

  const rows: VarianceRow[] = [];

  for (const accountCode of budget.accounts()) {
    const account = ledger.chart.get(accountCode);
    const budgeted = budget.range(accountCode, fromPeriod, toPeriod);
    const actual = ledger.balance(accountCode, from, to).balance;
    const varianceAmount = budgeted.minus(actual);

    rows.push({
      accountCode,
      accountName: account.name,
      budget: budgeted,
      actual,
      variance: varianceAmount,
      variancePercent: Math.round((varianceAmount.amount / budgeted.amount) * 1000) / 10,
      favourable: account.type === "expense" ? varianceAmount.isPositive() : varianceAmount.isNegative(),
    });
  }

  return {
    from,
    to,
    rows,
    totalBudget: sumOrZero(rows.map((r) => r.budget), currencyCode),
    totalActual: sumOrZero(rows.map((r) => r.actual), currencyCode),
    totalVariance: sumOrZero(rows.map((r) => r.variance), currencyCode),
  };
}

/** Rows whose variance exceeds a threshold, worst first. */
export function exceptions(report: VarianceReport, thresholdPercent: number): VarianceRow[] {
  return report.rows
    .filter((r) => Math.abs(r.variancePercent) >= thresholdPercent)
    .sort((a, b) => Math.abs(b.variancePercent) - Math.abs(a.variancePercent));
}
