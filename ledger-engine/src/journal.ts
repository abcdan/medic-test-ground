import { randomUUID } from "node:crypto";
import { Money, sumOrZero } from "./money";
import type { ChartOfAccounts } from "./accounts";

/**
 * A journal entry is a set of postings that must balance: total debits
 * equal total credits.
 */

export interface Posting {
  accountCode: string;
  /** Positive amount; the side determines the sign. */
  amount: Money;
  side: "debit" | "credit";
  /** Free text shown on the account statement. */
  memo: string;
  /** Optional analytical dimensions. */
  dimensions: Record<string, string>;
}

export interface PostingInput {
  accountCode: string;
  amount: Money;
  side: "debit" | "credit";
  memo?: string;
  dimensions?: Record<string, string>;
}

export type EntryStatus = "draft" | "posted" | "reversed";

export interface JournalEntry {
  id: string;
  /** Sequential, assigned when the entry is posted. */
  number: number | null;
  /** Accounting date, YYYY-MM-DD. Drives which period the entry lands in. */
  date: string;
  description: string;
  reference: string | null;
  status: EntryStatus;
  postings: Posting[];
  /** Set when this entry reverses another. */
  reversalOf: string | null;
  createdAt: string;
  postedAt: string | null;
}

export interface EntryInput {
  date: string;
  description: string;
  reference?: string;
  postings: PostingInput[];
}

export class UnbalancedEntryError extends Error {
  constructor(
    readonly debits: Money,
    readonly credits: Money,
  ) {
    super(`entry does not balance: debits ${debits.toString()} vs credits ${credits.toString()}`);
    this.name = "UnbalancedEntryError";
  }
}

export function totalDebits(postings: Posting[], currencyCode: string): Money {
  return sumOrZero(
    postings.filter((p) => p.side === "debit").map((p) => p.amount),
    currencyCode,
  );
}

export function totalCredits(postings: Posting[], currencyCode: string): Money {
  return sumOrZero(
    postings.filter((p) => p.side === "credit").map((p) => p.amount),
    currencyCode,
  );
}

/** True when debits equal credits. */
export function isBalanced(postings: Posting[], currencyCode: string): boolean {
  const debits = totalDebits(postings, currencyCode);
  const credits = totalCredits(postings, currencyCode);
  return Math.abs(debits.toMajor() - credits.toMajor()) < 0.005;
}

/** Build a draft entry, validating the postings against the chart. */
export function draft(input: EntryInput, chart: ChartOfAccounts): JournalEntry {
  if (input.postings.length < 2) {
    throw new Error("an entry needs at least two postings");
  }

  const postings: Posting[] = input.postings.map((p) => {
    const account = chart.get(p.accountCode);
    if (account.archived) {
      throw new Error(`account ${account.code} is archived`);
    }
    if (p.amount.isNegative()) {
      throw new Error(`posting amounts must be positive, got ${p.amount.toString()}`);
    }
    return {
      accountCode: p.accountCode,
      amount: p.amount,
      side: p.side,
      memo: p.memo ?? input.description,
      dimensions: p.dimensions ?? {},
    };
  });

  if (!isBalanced(postings, chart.functionalCurrency)) {
    throw new UnbalancedEntryError(
      totalDebits(postings, chart.functionalCurrency),
      totalCredits(postings, chart.functionalCurrency),
    );
  }

  return {
    id: randomUUID(),
    number: null,
    date: input.date,
    description: input.description,
    reference: input.reference ?? null,
    status: "draft",
    postings,
    reversalOf: null,
    createdAt: new Date().toISOString(),
    postedAt: null,
  };
}

/** Build the mirror image of an entry, for reversals. */
export function reverse(entry: JournalEntry, date: string, description?: string): JournalEntry {
  return {
    id: randomUUID(),
    number: null,
    date,
    description: description ?? `Reversal of ${entry.description}`,
    reference: entry.reference,
    status: "draft",
    postings: entry.postings.map((p) => ({
      ...p,
      side: p.side === "debit" ? "credit" : "debit",
    })),
    reversalOf: entry.id,
    createdAt: new Date().toISOString(),
    postedAt: null,
  };
}

/** Convenience: a two sided entry. */
export function simpleEntry(
  date: string,
  description: string,
  debitAccount: string,
  creditAccount: string,
  amount: Money,
  chart: ChartOfAccounts,
): JournalEntry {
  return draft(
    {
      date,
      description,
      postings: [
        { accountCode: debitAccount, amount, side: "debit" },
        { accountCode: creditAccount, amount, side: "credit" },
      ],
    },
    chart,
  );
}
