import { Money, sumOrZero } from "../money";
import type { Ledger } from "../ledger";

export interface IncomeStatementLine {
  code: string;
  name: string;
  amount: Money;
}

export interface IncomeStatement {
  from: string;
  to: string;
  revenue: IncomeStatementLine[];
  totalRevenue: Money;
  expenses: IncomeStatementLine[];
  totalExpenses: Money;
  grossProfit: Money;
  netIncome: Money;
  marginPercent: number;
}

/** Revenue minus expenses over a window. */
export function incomeStatement(ledger: Ledger, from: string, to: string): IncomeStatement {
  const currencyCode = ledger.chart.functionalCurrency;

  const revenue = ledger.chart
    .list("revenue")
    .map((account) => ({
      code: account.code,
      name: account.name,
      amount: ledger.balance(account.code, from, to).balance,
    }))
    .filter((line) => !line.amount.isZero());

  const expenses = ledger.chart
    .list("expense")
    .map((account) => ({
      code: account.code,
      name: account.name,
      amount: ledger.balance(account.code, from, to).balance,
    }))
    .filter((line) => !line.amount.isZero());

  const totalRevenue = sumOrZero(revenue.map((l) => l.amount), currencyCode);
  const totalExpenses = sumOrZero(expenses.map((l) => l.amount), currencyCode);

  const cogs = ledger.rollupBalance("5000", from, to);
  const grossProfit = totalRevenue.minus(cogs);
  const netIncome = totalRevenue.minus(totalExpenses);

  return {
    from,
    to,
    revenue,
    totalRevenue,
    expenses,
    totalExpenses,
    grossProfit,
    netIncome,
    marginPercent: Math.round((netIncome.amount / totalRevenue.amount) * 1000) / 10,
  };
}
