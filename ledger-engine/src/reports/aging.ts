import { Money, sumOrZero } from "../money";
import type { Ledger } from "../ledger";

export interface AgedItem {
  reference: string;
  date: string;
  daysOutstanding: number;
  amount: Money;
  bucket: string;
}

export interface AgingReport {
  asOf: string;
  accountCode: string;
  items: AgedItem[];
  buckets: Record<string, Money>;
  total: Money;
}

export const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days lie between two YYYY-MM-DD dates. */
export function daysBetween(from: string, to: string): number {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS);
}

export function bucketFor(days: number): string {
  if (days <= 0) return "current";
  if (days < 30) return "1-30";
  if (days < 60) return "31-60";
  if (days < 90) return "61-90";
  return "90+";
}

/**
 * Age the open items on a receivable or payable account. Each posting on
 * the account's normal side is an open item; postings on the other side
 * are settlements and are netted off oldest first.
 */
export function agingReport(ledger: Ledger, accountCode: string, asOf: string): AgingReport {
  const currencyCode = ledger.chart.get(accountCode).currencyCode;
  const normal = ledger.chart.normalBalance(accountCode);
  const refs = ledger.postingsFor(accountCode, undefined, asOf);

  const open: { reference: string; date: string; remaining: number }[] = [];
  let settlement = 0;

  for (const { entry, posting } of refs) {
    if (posting.side === normal) {
      open.push({
        reference: entry.reference ?? entry.id,
        date: entry.date,
        remaining: posting.amount.amount,
      });
    } else {
      settlement += posting.amount.amount;
    }
  }

  open.sort((a, b) => a.date.localeCompare(b.date));

  for (const item of open) {
    if (settlement <= 0) break;
    const applied = Math.min(settlement, item.remaining);
    item.remaining -= applied;
    settlement -= applied;
  }

  const items: AgedItem[] = open
    .filter((item) => item.remaining > 0)
    .map((item) => {
      const days = daysBetween(item.date, asOf);
      return {
        reference: item.reference,
        date: item.date,
        daysOutstanding: days,
        amount: Money.fromMinor(item.remaining, currencyCode),
        bucket: bucketFor(days),
      };
    });

  const buckets: Record<string, Money> = {};
  for (const name of BUCKETS) {
    buckets[name] = sumOrZero(
      items.filter((i) => i.bucket === name).map((i) => i.amount),
      currencyCode,
    );
  }

  return {
    asOf,
    accountCode,
    items,
    buckets,
    total: sumOrZero(items.map((i) => i.amount), currencyCode),
  };
}
