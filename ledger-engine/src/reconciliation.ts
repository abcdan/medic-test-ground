import { Money } from "./money";
import type { Ledger } from "./ledger";
import { daysBetween } from "./reports/aging";

/**
 * Bank reconciliation.
 *
 * Matches statement lines from the bank against postings on the bank
 * account, so the operator only has to look at what did not match.
 */

export interface StatementLine {
  id: string;
  date: string;
  amount: Money;
  description: string;
  counterparty: string;
}

export interface Match {
  statementLineId: string;
  entryId: string;
  confidence: number;
  reason: string;
}

export interface ReconciliationResult {
  matched: Match[];
  unmatchedStatementLines: StatementLine[];
  unmatchedEntryIds: string[];
  statementTotal: Money;
  ledgerTotal: Money;
  difference: Money;
}

export interface MatchOptions {
  /** How many days apart a statement line and a posting may be. */
  toleranceDays: number;
  /** Minimum confidence to auto-match. */
  minConfidence: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  toleranceDays: 3,
  minConfidence: 0.6,
};

/** Similarity between two free text descriptions, 0 to 1. */
export function textSimilarity(a: string, b: string): number {
  const left = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const right = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared++;
  }
  return shared / Math.max(left.size, right.size);
}

/**
 * Score a candidate pairing. Exact amount is required; the date distance
 * and the description similarity decide the confidence.
 */
export function score(line: StatementLine, entryDate: string, description: string, options: MatchOptions): number {
  const days = Math.abs(daysBetween(entryDate, line.date));
  if (days > options.toleranceDays) return 0;

  const dateScore = 1 - days / (options.toleranceDays + 1);
  const textScore = textSimilarity(line.description, description);

  return dateScore * 0.5 + textScore * 0.5;
}

export function reconcile(
  ledger: Ledger,
  bankAccountCode: string,
  lines: StatementLine[],
  from: string,
  to: string,
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): ReconciliationResult {
  const currencyCode = ledger.chart.get(bankAccountCode).currencyCode;
  const refs = ledger.postingsFor(bankAccountCode, from, to);

  const matched: Match[] = [];
  const usedEntries = new Set<string>();
  const usedLines = new Set<string>();

  for (const line of lines) {
    let best: { entryId: string; confidence: number } | null = null;

    for (const { entry, posting } of refs) {
      if (usedEntries.has(entry.id)) continue;

      const signed = posting.side === "debit" ? posting.amount : posting.amount.negate();
      if (!signed.equals(line.amount)) continue;

      const confidence = score(line, entry.date, entry.description, options);
      if (!best || confidence > best.confidence) {
        best = { entryId: entry.id, confidence };
      }
    }

    if (best && best.confidence >= options.minConfidence) {
      matched.push({
        statementLineId: line.id,
        entryId: best.entryId,
        confidence: Math.round(best.confidence * 100) / 100,
        reason: "amount + date + description",
      });
      usedEntries.add(best.entryId);
      usedLines.add(line.id);
    }
  }

  const statementTotal = lines
    .map((l) => l.amount)
    .reduce((a, b) => a.plus(b), Money.zero(currencyCode));

  const ledgerTotal = ledger.balance(bankAccountCode, from, to).balance;

  return {
    matched,
    unmatchedStatementLines: lines.filter((l) => !usedLines.has(l.id)),
    unmatchedEntryIds: refs.map((r) => r.entry.id).filter((id) => !usedEntries.has(id)),
    statementTotal,
    ledgerTotal,
    difference: statementTotal.minus(ledgerTotal),
  };
}
