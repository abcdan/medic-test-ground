import { randomUUID } from "node:crypto";
import type { Order, OrderLine } from "./order";
import { unfulfilledQuantity } from "./order";

/**
 * Fulfilments and shipments.
 *
 * An order can ship in several parcels from several locations. Each
 * fulfilment records what went in the box and how it is travelling.
 */

export type FulfilmentState = "pending" | "in-transit" | "delivered" | "failed" | "cancelled";

export interface FulfilmentLine {
  orderLineId: string;
  quantity: number;
}

export interface Fulfilment {
  id: string;
  orderId: string;
  locationId: string;
  state: FulfilmentState;
  lines: FulfilmentLine[];
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  /** Tell the customer it is on its way. */
  notifyCustomer: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrackingEvent {
  fulfilmentId: string;
  at: string;
  status: string;
  description: string;
  location: string | null;
}

export class FulfilmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FulfilmentError";
  }
}

const TRACKING_URLS: Record<string, string> = {
  postnl: "https://postnl.nl/tracktrace/?B={tracking}",
  dhl: "https://www.dhl.com/track?tracking-id={tracking}",
  dpd: "https://tracking.dpd.de/status/en_US/parcel/{tracking}",
  ups: "https://www.ups.com/track?tracknum={tracking}",
};

export function trackingUrlFor(carrier: string, trackingNumber: string): string | null {
  const template = TRACKING_URLS[carrier.toLowerCase()];
  if (!template) return null;
  return template.replace("{tracking}", trackingNumber);
}

export interface CreateFulfilmentInput {
  locationId: string;
  lines: FulfilmentLine[];
  carrier?: string;
  trackingNumber?: string;
  notifyCustomer?: boolean;
}

/** Ship some or all of an order. */
export function create(order: Order, input: CreateFulfilmentInput): Fulfilment {
  if (order.status === "cancelled") {
    throw new FulfilmentError("order_cancelled", `${order.name} is cancelled`);
  }

  if (input.lines.length === 0) {
    throw new FulfilmentError("no_lines", "A fulfilment needs at least one line");
  }

  for (const line of input.lines) {
    const orderLine = order.lines.find((l) => l.id === line.orderLineId);
    if (!orderLine) {
      throw new FulfilmentError("unknown_line", `No line ${line.orderLineId} on ${order.name}`);
    }
    if (line.quantity > unfulfilledQuantity(orderLine)) {
      throw new FulfilmentError(
        "over_fulfil",
        `Only ${unfulfilledQuantity(orderLine)} of ${orderLine.sku} left to ship`,
      );
    }
  }

  const now = new Date().toISOString();
  const carrier = input.carrier ?? null;
  const tracking = input.trackingNumber ?? null;

  const fulfilment: Fulfilment = {
    id: randomUUID(),
    orderId: order.id,
    locationId: input.locationId,
    state: tracking ? "in-transit" : "pending",
    lines: input.lines,
    carrier,
    trackingNumber: tracking,
    trackingUrl: carrier && tracking ? trackingUrlFor(carrier, tracking) : null,
    shippedAt: tracking ? now : null,
    deliveredAt: null,
    notifyCustomer: input.notifyCustomer ?? true,
    createdAt: now,
    updatedAt: now,
  };

  for (const line of input.lines) {
    const orderLine = order.lines.find((l) => l.id === line.orderLineId)!;
    orderLine.fulfilledQuantity += line.quantity;
  }

  return fulfilment;
}

/** Attach tracking after the fact. */
export function addTracking(fulfilment: Fulfilment, carrier: string, trackingNumber: string): Fulfilment {
  fulfilment.carrier = carrier;
  fulfilment.trackingNumber = trackingNumber;
  fulfilment.trackingUrl = trackingUrlFor(carrier, trackingNumber);
  fulfilment.state = "in-transit";
  fulfilment.shippedAt = fulfilment.shippedAt ?? new Date().toISOString();
  fulfilment.updatedAt = new Date().toISOString();
  return fulfilment;
}

export function markDelivered(fulfilment: Fulfilment, at?: string): Fulfilment {
  fulfilment.state = "delivered";
  fulfilment.deliveredAt = at ?? new Date().toISOString();
  fulfilment.updatedAt = fulfilment.deliveredAt;
  return fulfilment;
}

/** Undo a fulfilment, putting the units back on the order. */
export function cancel(order: Order, fulfilment: Fulfilment): Fulfilment {
  if (fulfilment.state === "delivered") {
    throw new FulfilmentError("already_delivered", "That parcel has already been delivered");
  }

  for (const line of fulfilment.lines) {
    const orderLine = order.lines.find((l) => l.id === line.orderLineId);
    if (orderLine) orderLine.fulfilledQuantity -= line.quantity;
  }

  fulfilment.state = "cancelled";
  fulfilment.updatedAt = new Date().toISOString();
  return fulfilment;
}

/** Lines still waiting to ship. */
export function remainingLines(order: Order): { line: OrderLine; quantity: number }[] {
  return order.lines
    .filter((line) => line.requiresShipping && unfulfilledQuantity(line) > 0)
    .map((line) => ({ line, quantity: unfulfilledQuantity(line) }));
}

/** A packing slip, ready to render. */
export interface PackingSlip {
  orderName: string;
  fulfilmentId: string;
  shipTo: string[];
  lines: { sku: string; title: string; quantity: number; location: string }[];
  note: string;
  printedAt: string;
}

export function packingSlip(order: Order, fulfilment: Fulfilment, binLocations: Map<string, string>): PackingSlip {
  const address = order.shippingAddress;

  return {
    orderName: order.name,
    fulfilmentId: fulfilment.id,
    shipTo: address
      ? [
          `${address.firstName} ${address.lastName}`,
          address.company ?? "",
          address.line1,
          address.line2 ?? "",
          `${address.postalCode} ${address.city}`,
          address.countryCode,
        ].filter(Boolean)
      : [],
    lines: fulfilment.lines.map((line) => {
      const orderLine = order.lines.find((l) => l.id === line.orderLineId)!;
      return {
        sku: orderLine.sku,
        title: orderLine.title,
        quantity: line.quantity,
        location: binLocations.get(orderLine.sku) ?? "—",
      };
    }),
    note: order.note,
    printedAt: new Date().toISOString(),
  };
}

/** Group open fulfilments into a pick list, ordered by bin. */
export function pickList(
  fulfilments: Fulfilment[],
  orders: Map<string, Order>,
  binLocations: Map<string, string>,
): { bin: string; sku: string; quantity: number; orders: string[] }[] {
  const rows = new Map<string, { bin: string; sku: string; quantity: number; orders: string[] }>();

  for (const fulfilment of fulfilments.filter((f) => f.state === "pending")) {
    const order = orders.get(fulfilment.orderId);
    if (!order) continue;

    for (const line of fulfilment.lines) {
      const orderLine = order.lines.find((l) => l.id === line.orderLineId);
      if (!orderLine) continue;

      const existing = rows.get(orderLine.sku);
      if (existing) {
        existing.quantity += line.quantity;
        existing.orders.push(order.name);
      } else {
        rows.set(orderLine.sku, {
          bin: binLocations.get(orderLine.sku) ?? "zz",
          sku: orderLine.sku,
          quantity: line.quantity,
          orders: [order.name],
        });
      }
    }
  }

  return [...rows.values()].sort((a, b) => a.bin.localeCompare(b.bin));
}
