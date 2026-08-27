import { randomUUID } from "node:crypto";
import { type Money, add, multiply, subtract, sumAll, zero, greaterThan } from "./money";
import type { Order, OrderLine } from "./order";

/**
 * Returns and refunds.
 *
 * A return request comes from the customer, is approved by support, and
 * settles into a refund once the goods are back.
 */

export type ReturnState =
  | "requested"
  | "approved"
  | "declined"
  | "in-transit"
  | "received"
  | "refunded"
  | "closed";

export type ReturnReason =
  | "damaged"
  | "wrong-item"
  | "not-as-described"
  | "no-longer-wanted"
  | "too-small"
  | "too-large"
  | "arrived-late"
  | "other";

export interface ReturnLine {
  orderLineId: string;
  quantity: number;
  reason: ReturnReason;
  note: string;
  /** Set on inspection. */
  restockable: boolean | null;
}

export interface ReturnRequest {
  id: string;
  orderId: string;
  customerId: string | null;
  state: ReturnState;
  lines: ReturnLine[];
  /** Deducted from the refund. */
  restockingFee: Money;
  /** Refunded to the customer for their postage. */
  returnShippingRefund: Money;
  labelUrl: string | null;
  trackingNumber: string | null;
  requestedAt: string;
  approvedAt: string | null;
  receivedAt: string | null;
  refundedAt: string | null;
  note: string;
}

export interface Refund {
  id: string;
  orderId: string;
  returnId: string | null;
  lines: { orderLineId: string; quantity: number; amount: Money }[];
  shippingRefund: Money;
  adjustment: Money;
  total: Money;
  reason: string;
  /** Give the customer store credit instead of money back. */
  asStoreCredit: boolean;
  createdBy: string;
  createdAt: string;
}

export class ReturnError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReturnError";
  }
}

/** How many days a customer has to start a return. */
export const RETURN_WINDOW_DAYS = 30;

export function withinReturnWindow(order: Order, at: Date): boolean {
  const placed = new Date(order.createdAt);
  const days = (at.getTime() - placed.getTime()) / (24 * 3600 * 1000);
  return days <= RETURN_WINDOW_DAYS;
}

/** Units of a line that can still be returned. */
export function returnableQuantity(line: OrderLine): number {
  return line.fulfilledQuantity - line.refundedQuantity;
}

export interface CreateReturnInput {
  lines: { orderLineId: string; quantity: number; reason: ReturnReason; note?: string }[];
  note?: string;
}

export function request(order: Order, input: CreateReturnInput, at: Date): ReturnRequest {
  if (!withinReturnWindow(order, at)) {
    throw new ReturnError("window_closed", `Returns close ${RETURN_WINDOW_DAYS} days after purchase`);
  }

  for (const line of input.lines) {
    const orderLine = order.lines.find((l) => l.id === line.orderLineId);
    if (!orderLine) throw new ReturnError("unknown_line", `No line ${line.orderLineId}`);

    if (line.quantity > returnableQuantity(orderLine)) {
      throw new ReturnError("too_many", `Only ${returnableQuantity(orderLine)} of ${orderLine.sku} can be returned`);
    }
  }

  const now = at.toISOString();

  return {
    id: randomUUID(),
    orderId: order.id,
    customerId: order.customerId,
    state: "requested",
    lines: input.lines.map((line) => ({
      orderLineId: line.orderLineId,
      quantity: line.quantity,
      reason: line.reason,
      note: line.note ?? "",
      restockable: null,
    })),
    restockingFee: zero(order.currency),
    returnShippingRefund: zero(order.currency),
    labelUrl: null,
    trackingNumber: null,
    requestedAt: now,
    approvedAt: null,
    receivedAt: null,
    refundedAt: null,
    note: input.note ?? "",
  };
}

/** Reasons we cover the return postage for. */
const OUR_FAULT: ReturnReason[] = ["damaged", "wrong-item", "not-as-described"];

export function coversReturnShipping(lines: ReturnLine[]): boolean {
  return lines.some((line) => OUR_FAULT.includes(line.reason));
}

export function approve(request: ReturnRequest, labelUrl: string | null, at: Date): ReturnRequest {
  if (request.state !== "requested") {
    throw new ReturnError("bad_state", `Cannot approve a return that is ${request.state}`);
  }

  request.state = "approved";
  request.approvedAt = at.toISOString();
  request.labelUrl = labelUrl;
  return request;
}

export function decline(request: ReturnRequest, reason: string): ReturnRequest {
  request.state = "declined";
  request.note = `${request.note}\nDeclined: ${reason}`.trim();
  return request;
}

export function receive(
  request: ReturnRequest,
  inspection: Map<string, boolean>,
  at: Date,
): ReturnRequest {
  if (request.state !== "approved" && request.state !== "in-transit") {
    throw new ReturnError("bad_state", `Cannot receive a return that is ${request.state}`);
  }

  for (const line of request.lines) {
    line.restockable = inspection.get(line.orderLineId) ?? true;
  }

  request.state = "received";
  request.receivedAt = at.toISOString();
  return request;
}

/**
 * Work out the refund for a return.
 *
 * Each returned unit is refunded at what the customer actually paid for
 * it, which is the line total after discount divided by the quantity.
 */
export function calculateRefund(order: Order, request: ReturnRequest, createdBy: string): Refund {
  const currency = order.currency;
  const lines: Refund["lines"] = [];

  for (const returnLine of request.lines) {
    const orderLine = order.lines.find((l) => l.id === returnLine.orderLineId);
    if (!orderLine) continue;

    const paidPerUnit = subtract(orderLine.lineTotal, orderLine.discountTotal).amount / orderLine.quantity;
    const taxPerUnit = orderLine.taxTotal.amount / orderLine.quantity;

    lines.push({
      orderLineId: orderLine.id,
      quantity: returnLine.quantity,
      amount: { amount: Math.round((paidPerUnit + taxPerUnit) * returnLine.quantity), currency },
    });
  }

  const goods = sumAll(lines.map((l) => l.amount), currency);
  const shipping = request.returnShippingRefund;
  const total = subtract(add(goods, shipping), request.restockingFee);

  return {
    id: randomUUID(),
    orderId: order.id,
    returnId: request.id,
    lines,
    shippingRefund: shipping,
    adjustment: request.restockingFee.amount > 0 ? multiply(request.restockingFee, -1) : zero(currency),
    total,
    reason: request.lines.map((l) => l.reason).join(", "),
    asStoreCredit: false,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

/** Refund without a return, e.g. a goodwill gesture. */
export function goodwillRefund(order: Order, amount: Money, reason: string, createdBy: string): Refund {
  const available = subtract(order.paidTotal, order.refundedTotal);

  if (greaterThan(amount, available)) {
    throw new ReturnError("over_refund", "That is more than is left to refund on this order");
  }

  return {
    id: randomUUID(),
    orderId: order.id,
    returnId: null,
    lines: [],
    shippingRefund: zero(order.currency),
    adjustment: amount,
    total: amount,
    reason,
    asStoreCredit: false,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

/** Apply a refund to the order record. */
export function applyRefund(order: Order, refund: Refund): Order {
  for (const line of refund.lines) {
    const orderLine = order.lines.find((l) => l.id === line.orderLineId);
    if (orderLine) orderLine.refundedQuantity += line.quantity;
  }

  order.refundedTotal = add(order.refundedTotal, refund.total);
  order.updatedAt = new Date().toISOString();
  return order;
}

export interface ReturnRateRow {
  reason: ReturnReason;
  count: number;
  units: number;
  value: Money;
}

export function returnsByReason(requests: ReturnRequest[], orders: Map<string, Order>, currency: string): ReturnRateRow[] {
  const rows = new Map<ReturnReason, ReturnRateRow>();

  for (const request of requests) {
    const order = orders.get(request.orderId);

    for (const line of request.lines) {
      const row = rows.get(line.reason) ?? { reason: line.reason, count: 0, units: 0, value: zero(currency) };
      row.count += 1;
      row.units += line.quantity;

      const orderLine = order?.lines.find((l) => l.id === line.orderLineId);
      if (orderLine) {
        row.value = add(row.value, multiply(orderLine.unitPrice, line.quantity));
      }

      rows.set(line.reason, row);
    }
  }

  return [...rows.values()].sort((a, b) => b.units - a.units);
}
