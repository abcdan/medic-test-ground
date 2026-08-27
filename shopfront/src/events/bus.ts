import { randomUUID } from "node:crypto";
import type { Order } from "../domain/order";
import type { Cart } from "../domain/cart";
import type { Customer } from "../domain/customer";
import type { Fulfilment } from "../domain/fulfilment";
import type { Refund, ReturnRequest } from "../domain/returns";
import type { Transaction } from "../domain/payment";

/**
 * Domain events.
 *
 * Anything that wants to react to a business fact - the webhook
 * dispatcher, the search indexer, the analytics pipeline - subscribes
 * here rather than being called directly from the domain code.
 */

export interface EventMap {
  "cart.created": { cart: Cart };
  "cart.updated": { cart: Cart };
  "cart.abandoned": { cart: Cart; minutesIdle: number };
  "checkout.started": { cartId: string; sessionId: string };
  "checkout.completed": { order: Order };
  "order.created": { order: Order };
  "order.updated": { order: Order; changed: string[] };
  "order.cancelled": { order: Order; reason: string };
  "order.paid": { order: Order; transaction: Transaction };
  "order.fulfilled": { order: Order; fulfilment: Fulfilment };
  "order.partially_fulfilled": { order: Order; fulfilment: Fulfilment };
  "fulfilment.created": { fulfilment: Fulfilment };
  "fulfilment.delivered": { fulfilment: Fulfilment };
  "payment.authorised": { transaction: Transaction };
  "payment.captured": { transaction: Transaction };
  "payment.failed": { orderId: string; errorCode: string; message: string };
  "refund.created": { refund: Refund };
  "return.requested": { request: ReturnRequest };
  "return.approved": { request: ReturnRequest };
  "return.received": { request: ReturnRequest };
  "customer.created": { customer: Customer };
  "customer.updated": { customer: Customer };
  "customer.deleted": { customerId: string };
  "inventory.low": { variantId: string; sku: string; available: number };
  "product.published": { productId: string; handle: string };
  "product.unpublished": { productId: string };
}

export type EventName = keyof EventMap;

export interface Envelope<K extends EventName = EventName> {
  id: string;
  name: K;
  payload: EventMap[K];
  occurredAt: string;
  /** Groups events emitted by one request. */
  correlationId: string | null;
  /** Which shop the event belongs to. */
  shopId: string;
}

export type Handler<K extends EventName> = (envelope: Envelope<K>) => void | Promise<void>;

export interface Subscription {
  unsubscribe(): void;
}

export class EventBus {
  private handlers = new Map<EventName, Handler<EventName>[]>();
  private wildcards: Handler<EventName>[] = [];
  private history: Envelope[] = [];
  private historyLimit = 500;

  constructor(private readonly shopId = "default") {}

  on<K extends EventName>(name: K, handler: Handler<K>): Subscription {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as Handler<EventName>);
    this.handlers.set(name, list);

    return {
      unsubscribe: () => {
        const current = this.handlers.get(name) ?? [];
        this.handlers.set(
          name,
          current.filter((h) => h !== (handler as Handler<EventName>)),
        );
      },
    };
  }

  /** Subscribe to everything, e.g. for the audit log. */
  onAny(handler: Handler<EventName>): Subscription {
    this.wildcards.push(handler);
    return {
      unsubscribe: () => {
        this.wildcards = this.wildcards.filter((h) => h !== handler);
      },
    };
  }

  /** Fire an event. Handlers run in registration order. */
  emit<K extends EventName>(name: K, payload: EventMap[K], correlationId: string | null = null): Envelope<K> {
    const envelope: Envelope<K> = {
      id: randomUUID(),
      name,
      payload,
      occurredAt: new Date().toISOString(),
      correlationId,
      shopId: this.shopId,
    };

    this.history.push(envelope as Envelope);
    if (this.history.length > this.historyLimit) this.history.shift();

    for (const handler of this.handlers.get(name) ?? []) {
      handler(envelope as Envelope);
    }
    for (const handler of this.wildcards) {
      handler(envelope as Envelope);
    }

    return envelope;
  }

  /** Recent events, newest first, for the admin activity feed. */
  recent(limit = 50): Envelope[] {
    return [...this.history].reverse().slice(0, limit);
  }

  listenerCount(name: EventName): number {
    return (this.handlers.get(name) ?? []).length + this.wildcards.length;
  }

  removeAll(): void {
    this.handlers.clear();
    this.wildcards = [];
  }
}

export const bus = new EventBus();
