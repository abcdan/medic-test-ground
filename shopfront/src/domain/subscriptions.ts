import { randomUUID } from "node:crypto";
import { type Money, multiply, percentOf, subtract, sumAll, zero } from "./money";
import type { Address } from "./order";

/**
 * Subscriptions.
 *
 * A contract holds the lines, the cadence and the payment method. A
 * billing run turns due contracts into orders.
 */

export type Interval = "day" | "week" | "month" | "year";
export type ContractState = "active" | "paused" | "cancelled" | "past-due" | "expired";

export interface SubscriptionLine {
  id: string;
  variantId: string;
  sku: string;
  title: string;
  quantity: number;
  unitPrice: Money;
  /** Percentage off the catalogue price for subscribing. */
  discountPercent: number;
}

export interface Contract {
  id: string;
  customerId: string;
  state: ContractState;
  lines: SubscriptionLine[];
  currency: string;
  interval: Interval;
  intervalCount: number;
  /** Day of the month to bill on, for monthly contracts. */
  billingAnchorDay: number | null;
  nextBillingDate: string;
  lastBilledAt: string | null;
  /** Number of cycles to run, null for open ended. */
  totalCycles: number | null;
  completedCycles: number;
  paymentMethodId: string;
  shippingAddress: Address;
  shippingMethodId: string;
  /** Consecutive failed payments. */
  failureCount: number;
  pausedUntil: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingAttempt {
  id: string;
  contractId: string;
  cycle: number;
  amount: Money;
  status: "succeeded" | "failed" | "skipped";
  orderId: string | null;
  errorCode: string | null;
  attemptedAt: string;
  nextRetryAt: string | null;
}

export class SubscriptionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SubscriptionError";
  }
}

export const MAX_PAYMENT_FAILURES = 4;
const RETRY_DAYS = [1, 3, 5, 7];

export function lineTotal(line: SubscriptionLine): Money {
  const gross = multiply(line.unitPrice, line.quantity);
  return subtract(gross, percentOf(gross, line.discountPercent));
}

export function contractTotal(contract: Contract): Money {
  return sumAll(contract.lines.map(lineTotal), contract.currency);
}

/** Move a date forward by one billing interval. */
export function advance(date: string, interval: Interval, count: number, anchorDay: number | null): string {
  const next = new Date(date);

  switch (interval) {
    case "day":
      next.setDate(next.getDate() + count);
      break;
    case "week":
      next.setDate(next.getDate() + count * 7);
      break;
    case "month":
      next.setMonth(next.getMonth() + count);
      if (anchorDay) next.setDate(anchorDay);
      break;
    case "year":
      next.setFullYear(next.getFullYear() + count);
      break;
  }

  return next.toISOString().slice(0, 10);
}

export interface CreateContractInput {
  customerId: string;
  lines: Omit<SubscriptionLine, "id">[];
  currency?: string;
  interval: Interval;
  intervalCount?: number;
  startDate: string;
  totalCycles?: number;
  paymentMethodId: string;
  shippingAddress: Address;
  shippingMethodId: string;
}

export function create(input: CreateContractInput): Contract {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    customerId: input.customerId,
    state: "active",
    lines: input.lines.map((line) => ({ ...line, id: randomUUID() })),
    currency: input.currency ?? "EUR",
    interval: input.interval,
    intervalCount: input.intervalCount ?? 1,
    billingAnchorDay: input.interval === "month" ? Number(input.startDate.slice(8, 10)) : null,
    nextBillingDate: input.startDate,
    lastBilledAt: null,
    totalCycles: input.totalCycles ?? null,
    completedCycles: 0,
    paymentMethodId: input.paymentMethodId,
    shippingAddress: input.shippingAddress,
    shippingMethodId: input.shippingMethodId,
    failureCount: 0,
    pausedUntil: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function isDue(contract: Contract, on: string): boolean {
  if (contract.state !== "active" && contract.state !== "past-due") return false;
  if (contract.pausedUntil && contract.pausedUntil > on) return false;
  return contract.nextBillingDate <= on;
}

/** Contracts to bill in this run. */
export function dueContracts(contracts: Contract[], on: string): Contract[] {
  return contracts.filter((contract) => isDue(contract, on));
}

export function recordSuccess(contract: Contract, orderId: string, at: string): BillingAttempt {
  contract.completedCycles += 1;
  contract.failureCount = 0;
  contract.lastBilledAt = at;
  contract.nextBillingDate = advance(
    contract.nextBillingDate,
    contract.interval,
    contract.intervalCount,
    contract.billingAnchorDay,
  );
  contract.state = "active";
  contract.updatedAt = at;

  if (contract.totalCycles !== null && contract.completedCycles >= contract.totalCycles) {
    contract.state = "expired";
  }

  return {
    id: randomUUID(),
    contractId: contract.id,
    cycle: contract.completedCycles,
    amount: contractTotal(contract),
    status: "succeeded",
    orderId,
    errorCode: null,
    attemptedAt: at,
    nextRetryAt: null,
  };
}

export function recordFailure(contract: Contract, errorCode: string, at: string): BillingAttempt {
  contract.failureCount += 1;
  contract.state = "past-due";
  contract.updatedAt = at;

  const exhausted = contract.failureCount >= MAX_PAYMENT_FAILURES;
  if (exhausted) {
    contract.state = "cancelled";
    contract.cancelledAt = at;
    contract.cancelReason = "payment_failed";
  }

  const retryIn = RETRY_DAYS[contract.failureCount - 1] ?? 7;
  const nextRetry = new Date(new Date(at).getTime() + retryIn * 24 * 3600 * 1000);

  return {
    id: randomUUID(),
    contractId: contract.id,
    cycle: contract.completedCycles + 1,
    amount: contractTotal(contract),
    status: "failed",
    orderId: null,
    errorCode,
    attemptedAt: at,
    nextRetryAt: exhausted ? null : nextRetry.toISOString().slice(0, 10),
  };
}

export function pause(contract: Contract, until: string): Contract {
  if (contract.state === "cancelled") {
    throw new SubscriptionError("cancelled", "That subscription has been cancelled");
  }
  contract.state = "paused";
  contract.pausedUntil = until;
  contract.updatedAt = new Date().toISOString();
  return contract;
}

export function resume(contract: Contract): Contract {
  contract.state = "active";
  contract.pausedUntil = null;
  contract.updatedAt = new Date().toISOString();
  return contract;
}

export function cancel(contract: Contract, reason: string): Contract {
  contract.state = "cancelled";
  contract.cancelledAt = new Date().toISOString();
  contract.cancelReason = reason;
  contract.updatedAt = contract.cancelledAt;
  return contract;
}

/** Skip the next delivery without changing the cadence. */
export function skipNext(contract: Contract): Contract {
  contract.nextBillingDate = advance(
    contract.nextBillingDate,
    contract.interval,
    contract.intervalCount,
    contract.billingAnchorDay,
  );
  contract.updatedAt = new Date().toISOString();
  return contract;
}

export function changeQuantity(contract: Contract, lineId: string, quantity: number): Contract {
  const line = contract.lines.find((l) => l.id === lineId);
  if (!line) throw new SubscriptionError("unknown_line", `No line ${lineId}`);
  if (quantity <= 0) {
    contract.lines = contract.lines.filter((l) => l.id !== lineId);
  } else {
    line.quantity = quantity;
  }
  contract.updatedAt = new Date().toISOString();
  return contract;
}

export interface SubscriptionMetrics {
  activeContracts: number;
  monthlyRecurringRevenue: Money;
  averageContractValue: Money;
  churnRate: number;
}

/** Normalise every cadence to a monthly figure. */
export function monthlyValue(contract: Contract): Money {
  const total = contractTotal(contract);

  switch (contract.interval) {
    case "day":
      return multiply(total, 30 / contract.intervalCount);
    case "week":
      return multiply(total, 4.33 / contract.intervalCount);
    case "month":
      return multiply(total, 1 / contract.intervalCount);
    case "year":
      return multiply(total, 1 / (12 * contract.intervalCount));
  }
}

export function metrics(contracts: Contract[], currency: string): SubscriptionMetrics {
  const active = contracts.filter((c) => c.state === "active");
  const cancelled = contracts.filter((c) => c.state === "cancelled");
  const mrr = sumAll(active.map(monthlyValue), currency);

  return {
    activeContracts: active.length,
    monthlyRecurringRevenue: mrr,
    averageContractValue: { amount: Math.round(mrr.amount / active.length), currency },
    churnRate: cancelled.length / contracts.length,
  };
}
