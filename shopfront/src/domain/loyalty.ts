import { randomUUID } from "node:crypto";
import { type Money, money, multiply, subtract, sumAll, zero } from "./money";
import type { Order } from "./order";
import type { Customer } from "./customer";

/**
 * Loyalty points.
 *
 * Points are earned on the net value of an order and spent as a discount
 * at checkout. Tiers unlock a higher earn rate and free shipping.
 */

export type TierName = "bronze" | "silver" | "gold" | "platinum";

export interface Tier {
  name: TierName;
  /** Annual spend in minor units needed to reach this tier. */
  threshold: Money;
  /** Points per unit of currency spent. */
  earnMultiplier: number;
  freeShipping: boolean;
  birthdayBonus: number;
}

export const TIERS: Tier[] = [
  { name: "bronze", threshold: money(0), earnMultiplier: 1, freeShipping: false, birthdayBonus: 100 },
  { name: "silver", threshold: money(25_000), earnMultiplier: 1.25, freeShipping: false, birthdayBonus: 250 },
  { name: "gold", threshold: money(75_000), earnMultiplier: 1.5, freeShipping: true, birthdayBonus: 500 },
  { name: "platinum", threshold: money(200_000), earnMultiplier: 2, freeShipping: true, birthdayBonus: 1000 },
];

/** How many minor units one point is worth when redeemed. */
export const POINT_VALUE_MINOR = 1;

/** Points earned per major unit of spend, before the tier multiplier. */
export const BASE_EARN_RATE = 10;

export type LedgerReason =
  | "purchase"
  | "redemption"
  | "referral"
  | "birthday"
  | "signup"
  | "review"
  | "adjustment"
  | "expiry";

export interface PointsEntry {
  id: string;
  customerId: string;
  points: number;
  reason: LedgerReason;
  orderId: string | null;
  note: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface LoyaltyAccount {
  customerId: string;
  entries: PointsEntry[];
  tier: TierName;
  /** Rolling twelve month spend that determines the tier. */
  qualifyingSpend: Money;
  joinedAt: string;
}

export class LoyaltyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LoyaltyError";
  }
}

export const POINTS_EXPIRY_MONTHS = 24;

export function openAccount(customer: Customer): LoyaltyAccount {
  return {
    customerId: customer.id,
    entries: [
      {
        id: randomUUID(),
        customerId: customer.id,
        points: 200,
        reason: "signup",
        orderId: null,
        note: "Welcome bonus",
        createdAt: new Date().toISOString(),
        expiresAt: null,
      },
    ],
    tier: "bronze",
    qualifyingSpend: zero(customer.currency),
    joinedAt: new Date().toISOString(),
  };
}

/** Points still live, ignoring anything that has expired. */
export function balance(account: LoyaltyAccount, at = new Date()): number {
  return account.entries
    .filter((entry) => entry.expiresAt === null || entry.expiresAt > at.toISOString())
    .reduce((total, entry) => total + entry.points, 0);
}

export function tierFor(spend: Money): Tier {
  return [...TIERS].reverse().find((tier) => spend.amount >= tier.threshold.amount) ?? TIERS[0];
}

/** What an order is worth in points. */
export function pointsFor(order: Order, tier: Tier): number {
  const net = subtract(order.subtotal, order.discountTotal);
  return Math.floor((net.amount / 100) * BASE_EARN_RATE * tier.earnMultiplier);
}

export function earn(account: LoyaltyAccount, order: Order): PointsEntry {
  const tier = TIERS.find((t) => t.name === account.tier) ?? TIERS[0];
  const points = pointsFor(order, tier);
  const expires = new Date();
  expires.setMonth(expires.getMonth() + POINTS_EXPIRY_MONTHS);

  const entry: PointsEntry = {
    id: randomUUID(),
    customerId: account.customerId,
    points,
    reason: "purchase",
    orderId: order.id,
    note: `Order ${order.name}`,
    createdAt: new Date().toISOString(),
    expiresAt: expires.toISOString(),
  };

  account.entries.push(entry);
  account.qualifyingSpend = { amount: account.qualifyingSpend.amount + order.total.amount, currency: order.currency };
  account.tier = tierFor(account.qualifyingSpend).name;

  return entry;
}

/** What a number of points is worth as a discount. */
export function redemptionValue(points: number, currency = "EUR"): Money {
  return money(points * POINT_VALUE_MINOR, currency);
}

/** How many points are needed for a given discount. */
export function pointsNeeded(amount: Money): number {
  return Math.ceil(amount.amount / POINT_VALUE_MINOR);
}

export function redeem(account: LoyaltyAccount, points: number, orderId: string): PointsEntry {
  if (points <= 0) throw new LoyaltyError("bad_amount", "Redeem at least one point");
  if (points > balance(account)) {
    throw new LoyaltyError("insufficient", `Only ${balance(account)} points available`);
  }

  const entry: PointsEntry = {
    id: randomUUID(),
    customerId: account.customerId,
    points: -points,
    reason: "redemption",
    orderId,
    note: `Redeemed against order`,
    createdAt: new Date().toISOString(),
    expiresAt: null,
  };

  account.entries.push(entry);
  return entry;
}

/** Give points back when an order is refunded. */
export function reverse(account: LoyaltyAccount, orderId: string): PointsEntry[] {
  const original = account.entries.filter((entry) => entry.orderId === orderId);
  const reversals: PointsEntry[] = [];

  for (const entry of original) {
    const reversal: PointsEntry = {
      id: randomUUID(),
      customerId: account.customerId,
      points: -entry.points,
      reason: "adjustment",
      orderId,
      note: `Reversal of ${entry.reason}`,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };
    account.entries.push(reversal);
    reversals.push(reversal);
  }

  return reversals;
}

export function grant(account: LoyaltyAccount, points: number, reason: LedgerReason, note: string): PointsEntry {
  const entry: PointsEntry = {
    id: randomUUID(),
    customerId: account.customerId,
    points,
    reason,
    orderId: null,
    note,
    createdAt: new Date().toISOString(),
    expiresAt: null,
  };
  account.entries.push(entry);
  return entry;
}

/** Points about to expire, for the reminder email. */
export function expiringSoon(account: LoyaltyAccount, withinDays: number, at = new Date()): number {
  const cutoff = new Date(at.getTime() + withinDays * 24 * 3600 * 1000).toISOString();

  return account.entries
    .filter((entry) => entry.points > 0 && entry.expiresAt !== null && entry.expiresAt < cutoff)
    .reduce((total, entry) => total + entry.points, 0);
}

export interface TierProgress {
  current: Tier;
  next: Tier | null;
  spendToNext: Money | null;
  percentComplete: number;
}

export function progress(account: LoyaltyAccount): TierProgress {
  const current = tierFor(account.qualifyingSpend);
  const index = TIERS.findIndex((tier) => tier.name === current.name);
  const next = TIERS[index + 1] ?? null;

  if (!next) {
    return { current, next: null, spendToNext: null, percentComplete: 100 };
  }

  const span = next.threshold.amount - current.threshold.amount;
  const done = account.qualifyingSpend.amount - current.threshold.amount;

  return {
    current,
    next,
    spendToNext: money(next.threshold.amount - account.qualifyingSpend.amount, account.qualifyingSpend.currency),
    percentComplete: Math.round((done / span) * 100),
  };
}

export interface LoyaltyLiability {
  outstandingPoints: number;
  monetaryValue: Money;
  accountsWithBalance: number;
}

/** What the programme owes, for the balance sheet. */
export function liability(accounts: LoyaltyAccount[], currency = "EUR"): LoyaltyLiability {
  const balances = accounts.map((account) => balance(account));
  const outstanding = balances.reduce((total, points) => total + points, 0);

  return {
    outstandingPoints: outstanding,
    monetaryValue: redemptionValue(outstanding, currency),
    accountsWithBalance: balances.filter((points) => points > 0).length,
  };
}
