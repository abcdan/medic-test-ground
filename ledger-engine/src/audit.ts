import { createHash } from "node:crypto";
import type { JournalEntry } from "./journal";
import type { Ledger } from "./ledger";

/**
 * Audit trail.
 *
 * Every posted entry is hashed together with the hash of the one before
 * it, so tampering with history shows up as a broken chain.
 */

export interface AuditRecord {
  sequence: number;
  entryId: string;
  entryNumber: number | null;
  actor: string;
  action: "post" | "reverse" | "close" | "reopen" | "adjust";
  at: string;
  hash: string;
  previousHash: string;
}

export function hashEntry(entry: JournalEntry, previousHash: string): string {
  const canonical = JSON.stringify({
    date: entry.date,
    description: entry.description,
    postings: entry.postings.map((p) => ({
      account: p.accountCode,
      amount: p.amount.amount,
      side: p.side,
    })),
  });
  return createHash("sha256").update(previousHash + canonical).digest("hex");
}

const GENESIS = "0".repeat(64);

export class AuditTrail {
  private records: AuditRecord[] = [];

  record(entry: JournalEntry, actor: string, action: AuditRecord["action"]): AuditRecord {
    const previousHash = this.records.length > 0 ? this.records[this.records.length - 1].hash : GENESIS;

    const record: AuditRecord = {
      sequence: this.records.length + 1,
      entryId: entry.id,
      entryNumber: entry.number,
      actor,
      action,
      at: new Date().toISOString(),
      hash: hashEntry(entry, previousHash),
      previousHash,
    };

    this.records.push(record);
    return record;
  }

  /** Walk the chain and report the first link that does not verify. */
  verify(ledger: Ledger): { ok: boolean; brokenAt: number | null } {
    let previousHash = GENESIS;

    for (const record of this.records) {
      const entry = ledger.get(record.entryId);
      if (!entry) return { ok: false, brokenAt: record.sequence };

      if (hashEntry(entry, previousHash) !== record.hash) {
        return { ok: false, brokenAt: record.sequence };
      }
      previousHash = record.hash;
    }

    return { ok: true, brokenAt: null };
  }

  forEntry(entryId: string): AuditRecord[] {
    return this.records.filter((r) => r.entryId === entryId);
  }

  byActor(actor: string): AuditRecord[] {
    return this.records.filter((r) => r.actor === actor);
  }

  all(): AuditRecord[] {
    return [...this.records];
  }

  get size(): number {
    return this.records.length;
  }
}
