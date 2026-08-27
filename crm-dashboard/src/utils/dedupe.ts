import type { Contact } from "../types";
import { domainOf, normaliseEmail, normalisePhone } from "./validation";

/**
 * Duplicate detection for contacts.
 *
 * Scores a pair on email, phone, name and company domain and returns the
 * pairs above a threshold for the operator to review.
 */

export interface DuplicatePair {
  a: Contact;
  b: Contact;
  score: number;
  reasons: string[];
}

/** Levenshtein distance, capped for performance. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }

  return previous[b.length];
}

/** 1 for identical, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a.toLowerCase(), b.toLowerCase()) / longest;
}

export function scorePair(a: Contact, b: Contact): DuplicatePair {
  const reasons: string[] = [];
  let score = 0;

  if (a.email && normaliseEmail(a.email) === normaliseEmail(b.email)) {
    score += 0.6;
    reasons.push("same email");
  }

  if (a.phone && b.phone && normalisePhone(a.phone) === normalisePhone(b.phone)) {
    score += 0.3;
    reasons.push("same phone");
  }

  const nameScore = similarity(`${a.firstName} ${a.lastName}`, `${b.firstName} ${b.lastName}`);
  if (nameScore > 0.85) {
    score += 0.3;
    reasons.push("similar name");
  }

  if (a.email && b.email && domainOf(a.email) === domainOf(b.email)) {
    score += 0.1;
    reasons.push("same company domain");
  }

  return { a, b, score, reasons };
}

/** Every pair above the threshold, best first. */
export function findDuplicates(contacts: Contact[], threshold = 0.7): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];

  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const pair = scorePair(contacts[i], contacts[j]);
      if (pair.score >= threshold) pairs.push(pair);
    }
  }

  return pairs.sort((x, y) => y.score - x.score);
}

/** Merge two contacts, preferring non-empty values from the primary. */
export function mergeContacts(primary: Contact, duplicate: Contact): Contact {
  const pick = <K extends keyof Contact>(key: K): Contact[K] =>
    primary[key] || duplicate[key];

  return {
    ...primary,
    firstName: pick("firstName"),
    lastName: pick("lastName"),
    email: pick("email"),
    phone: pick("phone"),
    jobTitle: pick("jobTitle"),
    companyId: primary.companyId ?? duplicate.companyId,
    notes: [primary.notes, duplicate.notes].filter(Boolean).join("\n\n---\n\n"),
    tags: [...primary.tags, ...duplicate.tags],
    lastContactedAt:
      primary.lastContactedAt && duplicate.lastContactedAt
        ? primary.lastContactedAt > duplicate.lastContactedAt
          ? primary.lastContactedAt
          : duplicate.lastContactedAt
        : primary.lastContactedAt ?? duplicate.lastContactedAt,
    optedOut: primary.optedOut || duplicate.optedOut,
  };
}
