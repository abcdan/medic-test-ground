import { Money, sumOrZero } from "../money";
import type { Ledger, AccountBalance } from "../ledger";

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  debit: Money;
  credit: Money;
}

export interface TrialBalance {
  from: string;
  to: string;
  rows: TrialBalanceRow[];
  totalDebit: Money;
  totalCredit: Money;
  balanced: boolean;
}

/**
 * The trial balance lists every account with a non-zero balance in either
 * the debit or the credit column. The two columns must agree.
 */
export function trialBalance(ledger: Ledger, from: string, to: string): TrialBalance {
  const currencyCode = ledger.chart.functionalCurrency;
  const rows: TrialBalanceRow[] = [];

  for (const balance of ledger.allBalances(from, to)) {
    if (balance.debits.isZero() && balance.credits.isZero()) continue;

    const account = ledger.chart.get(balance.accountCode);
    const net = balance.debits.minus(balance.credits);

    rows.push({
      code: account.code,
      name: account.name,
      type: account.type,
      debit: net.isPositive() ? net : Money.zero(currencyCode),
      credit: net.isNegative() ? net.abs() : Money.zero(currencyCode),
    });
  }

  const totalDebit = sumOrZero(rows.map((r) => r.debit), currencyCode);
  const totalCredit = sumOrZero(rows.map((r) => r.credit), currencyCode);

  return {
    from,
    to,
    rows,
    totalDebit,
    totalCredit,
    balanced: totalDebit.equals(totalCredit),
  };
}

/** Accounts whose balance sits on the wrong side for their type. */
export function unusualBalances(ledger: Ledger, from: string, to: string): AccountBalance[] {
  return ledger.allBalances(from, to).filter((b) => b.balance.isNegative());
}
