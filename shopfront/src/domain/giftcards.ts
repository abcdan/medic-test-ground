import { randomUUID, createHash, randomBytes } from "node:crypto";
import { type Money, add, subtract, sumAll, zero, greaterThan, lessThan } from "./money";

/**
 * Gift cards.
 *
 * A card has a code the customer types at checkout and a balance that is
 * drawn down across orders. The full code is never stored; only its hash
 * and the last four characters for display.
 */

export type GiftCardState = "active" | "redeemed" | "expired" | "disabled";

export interface GiftCard {
  id: string;
  /** sha256 of the normalised code. */
  codeHash: string;
  last4: string;
  initialValue: Money;
  balance: Money;
  state: GiftCardState;
  customerId: string | null;
  /** Set when the card was sold as a product rather than issued by support. */
  orderId: string | null;
  note: string;
  expiresAt: string | null;
  createdAt: string;
  disabledAt: string | null;
  transactions: GiftCardTransaction[];
}

export interface GiftCardTransaction {
  id: string;
  amount: Money;
  orderId: string | null;
  reason: "issue" | "redeem" | "refund" | "adjustment" | "expiry";
  createdAt: string;
}

export class GiftCardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GiftCardError";
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 16;

/** Generate a code in groups of four, e.g. ABCD-EFGH-JKLM-NPQR. */
export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";

  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
    if ((i + 1) % 4 === 0 && i < CODE_LENGTH - 1) code += "-";
  }

  return code;
}

export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function hashCode(code: string): string {
  return createHash("sha256").update(normaliseCode(code)).digest("hex");
}

export interface IssueInput {
  value: Money;
  customerId?: string;
  orderId?: string;
  note?: string;
  expiresInDays?: number;
}

export function issue(input: IssueInput): { card: GiftCard; code: string } {
  const code = generateCode();
  const now = new Date();

  const card: GiftCard = {
    id: randomUUID(),
    codeHash: hashCode(code),
    last4: normaliseCode(code).slice(-4),
    initialValue: input.value,
    balance: input.value,
    state: "active",
    customerId: input.customerId ?? null,
    orderId: input.orderId ?? null,
    note: input.note ?? "",
    expiresAt: input.expiresInDays
      ? new Date(now.getTime() + input.expiresInDays * 24 * 3600 * 1000).toISOString()
      : null,
    createdAt: now.toISOString(),
    disabledAt: null,
    transactions: [
      {
        id: randomUUID(),
        amount: input.value,
        orderId: input.orderId ?? null,
        reason: "issue",
        createdAt: now.toISOString(),
      },
    ],
  };

  return { card, code };
}

export function find(cards: GiftCard[], code: string): GiftCard | undefined {
  const hash = hashCode(code);
  return cards.find((card) => card.codeHash === hash);
}

export function isUsable(card: GiftCard, at: Date): boolean {
  if (card.state !== "active") return false;
  if (card.balance.amount <= 0) return false;
  if (card.expiresAt && card.expiresAt < at.toISOString()) return false;
  return true;
}

/** Draw down a card, up to whatever is left on it. */
export function redeem(card: GiftCard, amount: Money, orderId: string, at: Date): Money {
  if (!isUsable(card, at)) {
    throw new GiftCardError("unusable", "That gift card cannot be used");
  }

  const applied = greaterThan(amount, card.balance) ? card.balance : amount;

  card.balance = subtract(card.balance, applied);
  card.transactions.push({
    id: randomUUID(),
    amount: { amount: -applied.amount, currency: applied.currency },
    orderId,
    reason: "redeem",
    createdAt: at.toISOString(),
  });

  if (card.balance.amount === 0) card.state = "redeemed";

  return applied;
}

/** Put value back when an order paid by gift card is refunded. */
export function credit(card: GiftCard, amount: Money, orderId: string, at: Date): GiftCard {
  card.balance = add(card.balance, amount);
  card.state = "active";
  card.transactions.push({
    id: randomUUID(),
    amount,
    orderId,
    reason: "refund",
    createdAt: at.toISOString(),
  });
  return card;
}

export function disable(card: GiftCard, reason: string): GiftCard {
  card.state = "disabled";
  card.disabledAt = new Date().toISOString();
  card.note = `${card.note}\nDisabled: ${reason}`.trim();
  return card;
}

/** Cards whose expiry has passed, for the nightly sweep. */
export function expireCards(cards: GiftCard[], at: Date): GiftCard[] {
  const expired: GiftCard[] = [];

  for (const card of cards) {
    if (card.state !== "active") continue;
    if (!card.expiresAt || card.expiresAt >= at.toISOString()) continue;

    card.state = "expired";
    card.transactions.push({
      id: randomUUID(),
      amount: { amount: -card.balance.amount, currency: card.balance.currency },
      orderId: null,
      reason: "expiry",
      createdAt: at.toISOString(),
    });
    card.balance = zero(card.balance.currency);
    expired.push(card);
  }

  return expired;
}

/** Total outstanding liability, for the balance sheet. */
export function outstandingLiability(cards: GiftCard[], currency: string): Money {
  return sumAll(
    cards.filter((card) => card.state === "active").map((card) => card.balance),
    currency,
  );
}

/** Mask a code for display, e.g. ••••-••••-••••-NPQR. */
export function maskCode(card: GiftCard): string {
  return `••••-••••-••••-${card.last4}`;
}
