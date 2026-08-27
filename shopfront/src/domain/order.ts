import { randomUUID } from "node:crypto";
import { type Money, add, subtract, sumAll, zero } from "./money";
import type { Cart, CartTotals } from "./cart";
import type { TaxAddress } from "./tax";

/**
 * Orders.
 *
 * An order is an immutable record of what was agreed. Anything that
 * changes afterwards - a fulfilment, a refund, a cancellation - is a
 * separate record that references it.
 */

export type OrderStatus = "pending" | "open" | "cancelled" | "archived";
export type PaymentStatus =
  | "unpaid"
  | "authorised"
  | "partially-paid"
  | "paid"
  | "partially-refunded"
  | "refunded"
  | "voided";
export type FulfilmentStatus = "unfulfilled" | "partially-fulfilled" | "fulfilled" | "restocked";

export interface OrderLine {
  id: string;
  variantId: string;
  productId: string;
  sku: string;
  title: string;
  variantTitle: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
  discountTotal: Money;
  taxTotal: Money;
  /** How many units have shipped. */
  fulfilledQuantity: number;
  /** How many units have been refunded. */
  refundedQuantity: number;
  requiresShipping: boolean;
  taxCode: string;
  properties: Record<string, string>;
}

export interface Address {
  firstName: string;
  lastName: string;
  company: string | null;
  line1: string;
  line2: string | null;
  city: string;
  regionCode: string;
  postalCode: string;
  countryCode: string;
  phone: string | null;
}

export interface Order {
  id: string;
  /** Sequential, customer-facing. */
  number: number;
  name: string;
  cartId: string;
  customerId: string | null;
  email: string;
  currency: string;
  market: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfilmentStatus: FulfilmentStatus;
  lines: OrderLine[];
  subtotal: Money;
  discountTotal: Money;
  shippingTotal: Money;
  taxTotal: Money;
  total: Money;
  /** Sum of captured payments. */
  paidTotal: Money;
  refundedTotal: Money;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  shippingMethodName: string | null;
  discountCodes: string[];
  note: string;
  tags: string[];
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set when the customer's browser confirmed the order. */
  confirmedAt: string | null;
}

export class OrderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OrderError";
  }
}

export function toAddress(raw: Partial<Address>): Address {
  return {
    firstName: raw.firstName ?? "",
    lastName: raw.lastName ?? "",
    company: raw.company ?? null,
    line1: raw.line1 ?? "",
    line2: raw.line2 ?? null,
    city: raw.city ?? "",
    regionCode: raw.regionCode ?? "",
    postalCode: raw.postalCode ?? "",
    countryCode: raw.countryCode ?? "",
    phone: raw.phone ?? null,
  };
}

export function toTaxAddress(address: Address): TaxAddress {
  return {
    countryCode: address.countryCode,
    regionCode: address.regionCode,
    postalCode: address.postalCode,
  };
}

let orderSequence = 1000;

/** Turn a priced cart into an order. */
export function fromCart(
  cart: Cart,
  totals: CartTotals,
  addresses: { shipping: Address | null; billing: Address | null },
  shippingMethodName: string | null,
): Order {
  const now = new Date().toISOString();
  const number = ++orderSequence;

  const lines: OrderLine[] = cart.lines.map((line) => {
    const gross = { amount: line.unitPrice.amount * line.quantity, currency: cart.currency };
    const discount = totals.discounts.lineDiscounts.get(line.id) ?? zero(cart.currency);

    return {
      id: randomUUID(),
      variantId: line.variantId,
      productId: line.productId,
      sku: line.sku,
      title: line.title,
      variantTitle: line.variantTitle,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: gross,
      discountTotal: discount,
      taxTotal: zero(cart.currency),
      fulfilledQuantity: 0,
      refundedQuantity: 0,
      requiresShipping: line.requiresShipping,
      taxCode: line.taxCode,
      properties: line.properties,
    };
  });

  return {
    id: randomUUID(),
    number,
    name: `#${number}`,
    cartId: cart.id,
    customerId: cart.customerId,
    email: cart.email ?? "",
    currency: cart.currency,
    market: cart.market,
    status: "pending",
    paymentStatus: "unpaid",
    fulfilmentStatus: "unfulfilled",
    lines,
    subtotal: totals.subtotal,
    discountTotal: add(totals.orderDiscount, totals.shippingDiscount),
    shippingTotal: totals.shipping,
    taxTotal: totals.tax,
    total: totals.total,
    paidTotal: zero(cart.currency),
    refundedTotal: zero(cart.currency),
    shippingAddress: addresses.shipping,
    billingAddress: addresses.billing ?? addresses.shipping,
    shippingMethodName,
    discountCodes: cart.discountCodes,
    note: cart.note,
    tags: [],
    cancelledAt: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
  };
}

export function outstanding(order: Order): Money {
  return subtract(order.total, order.paidTotal);
}

export function isFullyPaid(order: Order): boolean {
  return order.paidTotal.amount >= order.total.amount;
}

export function refundable(order: Order): Money {
  return subtract(order.paidTotal, order.refundedTotal);
}

export function unfulfilledQuantity(line: OrderLine): number {
  return line.quantity - line.fulfilledQuantity;
}

export function isFullyFulfilled(order: Order): boolean {
  return order.lines
    .filter((line) => line.requiresShipping)
    .every((line) => unfulfilledQuantity(line) === 0);
}

/** Recompute the derived statuses after a payment or fulfilment. */
export function recomputeStatuses(order: Order): Order {
  if (order.status === "cancelled") return order;

  if (order.refundedTotal.amount > 0) {
    order.paymentStatus =
      order.refundedTotal.amount >= order.paidTotal.amount ? "refunded" : "partially-refunded";
  } else if (order.paidTotal.amount === 0) {
    order.paymentStatus = "unpaid";
  } else if (order.paidTotal.amount >= order.total.amount) {
    order.paymentStatus = "paid";
  } else {
    order.paymentStatus = "partially-paid";
  }

  const shippable = order.lines.filter((line) => line.requiresShipping);
  const fulfilled = shippable.filter((line) => unfulfilledQuantity(line) === 0);

  if (shippable.length === 0 || fulfilled.length === shippable.length) {
    order.fulfilmentStatus = "fulfilled";
  } else if (fulfilled.length > 0) {
    order.fulfilmentStatus = "partially-fulfilled";
  } else {
    order.fulfilmentStatus = "unfulfilled";
  }

  order.updatedAt = new Date().toISOString();
  return order;
}

export interface CancelInput {
  reason: string;
  restock: boolean;
  refund: boolean;
}

export function cancel(order: Order, input: CancelInput): Order {
  if (order.status === "cancelled") {
    throw new OrderError("already_cancelled", `${order.name} is already cancelled`);
  }
  if (order.fulfilmentStatus === "fulfilled") {
    throw new OrderError("already_shipped", `${order.name} has already shipped`);
  }

  order.status = "cancelled";
  order.cancelledAt = new Date().toISOString();
  order.cancelReason = input.reason;
  order.updatedAt = order.cancelledAt;

  return order;
}

/** Human summary for the order list. */
export function summarise(order: Order): string {
  const items = order.lines.reduce((n, line) => n + line.quantity, 0);
  return `${order.name} · ${items} item${items === 1 ? "" : "s"} · ${order.paymentStatus}`;
}

export interface OrderFilter {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  fulfilmentStatus?: FulfilmentStatus;
  customerId?: string;
  email?: string;
  createdAfter?: string;
  createdBefore?: string;
  search?: string;
  tags?: string[];
}

export function matchesFilter(order: Order, filter: OrderFilter): boolean {
  if (filter.status && order.status !== filter.status) return false;
  if (filter.paymentStatus && order.paymentStatus !== filter.paymentStatus) return false;
  if (filter.fulfilmentStatus && order.fulfilmentStatus !== filter.fulfilmentStatus) return false;
  if (filter.customerId && order.customerId !== filter.customerId) return false;
  if (filter.email && order.email !== filter.email) return false;
  if (filter.createdAfter && order.createdAt < filter.createdAfter) return false;
  if (filter.createdBefore && order.createdAt > filter.createdBefore) return false;
  if (filter.tags && filter.tags.length > 0 && !filter.tags.some((t) => order.tags.includes(t))) return false;

  if (filter.search) {
    const haystack = `${order.name} ${order.email} ${order.lines.map((l) => l.sku).join(" ")}`;
    if (!haystack.includes(filter.search)) return false;
  }

  return true;
}

export interface OrderMetrics {
  count: number;
  revenue: Money;
  averageOrderValue: Money;
  itemsPerOrder: number;
  refundRate: number;
}

export function metrics(orders: Order[], currency: string): OrderMetrics {
  const revenue = sumAll(orders.map((o) => o.total), currency);
  const items = orders.reduce((n, o) => n + o.lines.reduce((m, l) => m + l.quantity, 0), 0);
  const refunded = orders.filter((o) => o.refundedTotal.amount > 0).length;

  return {
    count: orders.length,
    revenue,
    averageOrderValue: { amount: Math.round(revenue.amount / orders.length), currency },
    itemsPerOrder: items / orders.length,
    refundRate: refunded / orders.length,
  };
}
