import { randomUUID, createHash, randomBytes, pbkdf2Sync } from "node:crypto";
import { type Money, add, sumAll, zero } from "./money";
import type { Order } from "./order";
import type { Address } from "./order";

/**
 * Customers, accounts and store credit.
 */

export type CustomerState = "guest" | "invited" | "enabled" | "disabled";

export interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  state: CustomerState;
  passwordHash: string | null;
  /** Marketing consent, per channel. */
  acceptsEmailMarketing: boolean;
  acceptsSmsMarketing: boolean;
  marketingConsentAt: string | null;
  groups: string[];
  tags: string[];
  note: string;
  addresses: SavedAddress[];
  defaultAddressId: string | null;
  taxExempt: boolean;
  vatId: string | null;
  locale: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  lastOrderAt: string | null;
  lastLoginAt: string | null;
}

export interface SavedAddress extends Address {
  id: string;
  label: string;
  isDefault: boolean;
}

export interface StoreCredit {
  id: string;
  customerId: string;
  balance: Money;
  transactions: CreditTransaction[];
  createdAt: string;
}

export interface CreditTransaction {
  id: string;
  amount: Money;
  reason: string;
  orderId: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface CustomerMetrics {
  orderCount: number;
  lifetimeValue: Money;
  averageOrderValue: Money;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  daysSinceLastOrder: number | null;
}

const PBKDF2_ITERATIONS = 100_000;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = pbkdf2Sync(plain, salt, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [, iterations, salt, expected] = stored.split("$");
  const derived = pbkdf2Sync(plain, salt, Number(iterations), 32, "sha256").toString("hex");
  return derived === expected;
}

export function fullName(customer: Customer): string {
  return `${customer.firstName} ${customer.lastName}`.trim() || customer.email;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface CreateCustomerInput {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  password?: string;
  acceptsEmailMarketing?: boolean;
  locale?: string;
  currency?: string;
}

export function create(input: CreateCustomerInput): Customer {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    email: normaliseEmail(input.email),
    firstName: input.firstName ?? "",
    lastName: input.lastName ?? "",
    phone: input.phone ?? null,
    state: input.password ? "enabled" : "guest",
    passwordHash: input.password ? hashPassword(input.password) : null,
    acceptsEmailMarketing: input.acceptsEmailMarketing ?? false,
    acceptsSmsMarketing: false,
    marketingConsentAt: input.acceptsEmailMarketing ? now : null,
    groups: [],
    tags: [],
    note: "",
    addresses: [],
    defaultAddressId: null,
    taxExempt: false,
    vatId: null,
    locale: input.locale ?? "en",
    currency: input.currency ?? "EUR",
    createdAt: now,
    updatedAt: now,
    lastOrderAt: null,
    lastLoginAt: null,
  };
}

export function addAddress(customer: Customer, address: Address, label: string, makeDefault = false): SavedAddress {
  const saved: SavedAddress = {
    ...address,
    id: randomUUID(),
    label,
    isDefault: makeDefault || customer.addresses.length === 0,
  };

  if (saved.isDefault) {
    for (const existing of customer.addresses) existing.isDefault = false;
    customer.defaultAddressId = saved.id;
  }

  customer.addresses.push(saved);
  customer.updatedAt = new Date().toISOString();
  return saved;
}

export function removeAddress(customer: Customer, addressId: string): void {
  customer.addresses = customer.addresses.filter((a) => a.id !== addressId);
  if (customer.defaultAddressId === addressId) {
    customer.defaultAddressId = customer.addresses[0]?.id ?? null;
  }
}

export function defaultAddress(customer: Customer): SavedAddress | null {
  return customer.addresses.find((a) => a.id === customer.defaultAddressId) ?? null;
}

/** Roll up a customer's order history. */
export function metricsFor(customer: Customer, orders: Order[]): CustomerMetrics {
  const theirs = orders
    .filter((order) => order.customerId === customer.id && order.status !== "cancelled")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const lifetimeValue = sumAll(theirs.map((o) => o.total), customer.currency);
  const last = theirs[theirs.length - 1];

  return {
    orderCount: theirs.length,
    lifetimeValue,
    averageOrderValue: { amount: Math.round(lifetimeValue.amount / theirs.length), currency: customer.currency },
    firstOrderAt: theirs[0]?.createdAt ?? null,
    lastOrderAt: last?.createdAt ?? null,
    daysSinceLastOrder: last
      ? Math.floor((Date.now() - new Date(last.createdAt).getTime()) / (24 * 3600 * 1000))
      : null,
  };
}

/** Segment a customer for marketing. */
export function segmentOf(metrics: CustomerMetrics): string {
  if (metrics.orderCount === 0) return "prospect";
  if (metrics.orderCount === 1) return "new";
  if (metrics.daysSinceLastOrder !== null && metrics.daysSinceLastOrder > 365) return "lapsed";
  if (metrics.lifetimeValue.amount > 100_000) return "vip";
  return "returning";
}

export function creditBalance(credit: StoreCredit): Money {
  const live = credit.transactions.filter(
    (t) => t.expiresAt === null || t.expiresAt > new Date().toISOString(),
  );
  return sumAll(live.map((t) => t.amount), credit.balance.currency);
}

export function grantCredit(
  credit: StoreCredit,
  amount: Money,
  reason: string,
  expiresAt: string | null = null,
): StoreCredit {
  credit.transactions.push({
    id: randomUUID(),
    amount,
    reason,
    orderId: null,
    createdAt: new Date().toISOString(),
    expiresAt,
  });
  credit.balance = add(credit.balance, amount);
  return credit;
}

export function spendCredit(credit: StoreCredit, amount: Money, orderId: string): StoreCredit {
  credit.transactions.push({
    id: randomUUID(),
    amount: { amount: -amount.amount, currency: amount.currency },
    reason: "order",
    orderId,
    createdAt: new Date().toISOString(),
    expiresAt: null,
  });
  credit.balance = { amount: credit.balance.amount - amount.amount, currency: credit.balance.currency };
  return credit;
}

/** Anonymise a customer for a GDPR erasure request. */
export function anonymise(customer: Customer): Customer {
  const hash = createHash("sha256").update(customer.email).digest("hex").slice(0, 12);

  customer.email = `erased-${hash}@example.invalid`;
  customer.firstName = "Erased";
  customer.lastName = "Customer";
  customer.phone = null;
  customer.passwordHash = null;
  customer.state = "disabled";
  customer.addresses = [];
  customer.note = "";
  customer.vatId = null;
  customer.updatedAt = new Date().toISOString();

  return customer;
}

/** Everything we hold on a customer, for a data export request. */
export function exportData(customer: Customer, orders: Order[]): Record<string, unknown> {
  return {
    profile: customer,
    orders: orders.filter((order) => order.customerId === customer.id),
    exportedAt: new Date().toISOString(),
  };
}
