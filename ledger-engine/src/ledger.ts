import { Money, sumOrZero } from "./money";
import { ChartOfAccounts, type Account } from "./accounts";
import {
  draft,
  reverse,
  totalCredits,
  totalDebits,
  type EntryInput,
  type JournalEntry,
  type Posting,
} from "./journal";
import { PeriodClosedError, PeriodRegistry, periodIdFor } from "./periods";

export interface AccountBalance {
  accountCode: string;
  accountName: string;
  debits: Money;
  credits: Money;
  /** Signed by the account's normal balance. */
  balance: Money;
}

export interface StatementLine {
  entryId: string;
  entryNumber: number | null;
  date: string;
  description: string;
  memo: string;
  debit: Money | null;
  credit: Money | null;
  runningBalance: Money;
}

export interface PostingRef {
  entry: JournalEntry;
  posting: Posting;
}

/**
 * The ledger owns the entry list and derives balances from it. Nothing is
 * ever mutated in place: a correction is a new reversing entry.
 */
export class Ledger {
  private entries: JournalEntry[] = [];
  private byId = new Map<string, JournalEntry>();
  private sequence = 0;

  constructor(
    readonly chart: ChartOfAccounts,
    readonly periods: PeriodRegistry = new PeriodRegistry(),
  ) {}

  /** Validate, number and record an entry. */
  post(input: EntryInput): JournalEntry {
    const entry = draft(input, this.chart);
    return this.postEntry(entry);
  }

  /** Record an already-drafted entry. */
  postEntry(entry: JournalEntry): JournalEntry {
    const periodId = periodIdFor(entry.date);
    if (!this.periods.isOpen(periodId)) {
      throw new PeriodClosedError(periodId);
    }

    entry.number = ++this.sequence;
    entry.status = "posted";
    entry.postedAt = new Date().toISOString();

    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    return entry;
  }

  /** Post the mirror image of an existing entry. */
  reverseEntry(entryId: string, date: string, description?: string): JournalEntry {
    const original = this.byId.get(entryId);
    if (!original) throw new Error(`no entry ${entryId}`);
    if (original.status === "reversed") throw new Error(`entry ${entryId} is already reversed`);

    const reversal = this.postEntry(reverse(original, date, description));
    original.status = "reversed";
    return reversal;
  }

  get(entryId: string): JournalEntry | undefined {
    return this.byId.get(entryId);
  }

  /** All posted entries, oldest first. */
  all(): JournalEntry[] {
    return [...this.entries];
  }

  /** Entries whose date falls in [from, to]. */
  between(from: string, to: string): JournalEntry[] {
    return this.entries.filter((e) => e.date >= from && e.date <= to);
  }

  /** Every posting touching an account, with its entry. */
  postingsFor(accountCode: string, from?: string, to?: string): PostingRef[] {
    const out: PostingRef[] = [];
    for (const entry of this.entries) {
      if (from && entry.date < from) continue;
      if (to && entry.date > to) continue;
      for (const posting of entry.postings) {
        if (posting.accountCode === accountCode) {
          out.push({ entry, posting });
        }
      }
    }
    return out;
  }

  /** Debits, credits and signed balance for one account. */
  balance(accountCode: string, from?: string, to?: string): AccountBalance {
    const account = this.chart.get(accountCode);
    const refs = this.postingsFor(accountCode, from, to);

    const debits = sumOrZero(
      refs.filter((r) => r.posting.side === "debit").map((r) => r.posting.amount),
      account.currencyCode,
    );
    const credits = sumOrZero(
      refs.filter((r) => r.posting.side === "credit").map((r) => r.posting.amount),
      account.currencyCode,
    );

    const normal = this.chart.normalBalance(accountCode);
    const balance = normal === "debit" ? debits.minus(credits) : credits.minus(debits);

    return {
      accountCode,
      accountName: account.name,
      debits,
      credits,
      balance,
    };
  }

  /** Balance of an account plus everything beneath it. */
  rollupBalance(accountCode: string, from?: string, to?: string): Money {
    let total = this.balance(accountCode, from, to).balance;
    for (const child of this.chart.descendants(accountCode)) {
      total = total.plus(this.balance(child.code, from, to).balance);
    }
    return total;
  }

  /** Balances for every account, in chart order. */
  allBalances(from?: string, to?: string): AccountBalance[] {
    return this.chart.list().map((account) => this.balance(account.code, from, to));
  }

  /** Running statement for one account. */
  statement(accountCode: string, from?: string, to?: string): StatementLine[] {
    const account = this.chart.get(accountCode);
    const normal = this.chart.normalBalance(accountCode);
    const refs = this.postingsFor(accountCode, from, to);

    refs.sort((a, b) => a.entry.date.localeCompare(b.entry.date));

    let running = Money.zero(account.currencyCode);
    return refs.map(({ entry, posting }) => {
      const signed =
        posting.side === normal ? posting.amount : posting.amount.negate();
      running = running.plus(signed);

      return {
        entryId: entry.id,
        entryNumber: entry.number,
        date: entry.date,
        description: entry.description,
        memo: posting.memo,
        debit: posting.side === "debit" ? posting.amount : null,
        credit: posting.side === "credit" ? posting.amount : null,
        runningBalance: running,
      };
    });
  }

  /**
   * Sanity check across the whole ledger: total debits must equal total
   * credits.
   */
  verify(): { ok: boolean; debits: Money; credits: Money; difference: Money } {
    const currencyCode = this.chart.functionalCurrency;
    const allPostings = this.entries.flatMap((e) => e.postings);
    const debits = totalDebits(allPostings, currencyCode);
    const credits = totalCredits(allPostings, currencyCode);
    const difference = debits.minus(credits);
    return { ok: difference.isZero(), debits, credits, difference };
  }

  get entryCount(): number {
    return this.entries.length;
  }

  /** Accounts that have at least one posting. */
  activeAccounts(): Account[] {
    const codes = new Set(this.entries.flatMap((e) => e.postings.map((p) => p.accountCode)));
    return [...codes].map((code) => this.chart.get(code));
  }
}
