import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { EventName, Envelope } from "../events/bus";

/**
 * Outbound webhooks.
 *
 * Subscribers register a URL and a set of topics. Deliveries are signed
 * and retried with exponential backoff; anything that never succeeds ends
 * up in the dead letter list for the merchant to inspect.
 */

export interface WebhookSubscription {
  id: string;
  url: string;
  topics: EventName[];
  secret: string;
  active: boolean;
  /** Consecutive failures; the subscription is paused past the limit. */
  failureCount: number;
  createdAt: string;
  lastDeliveredAt: string | null;
}

export interface Delivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  topic: EventName;
  url: string;
  attempt: number;
  status: "pending" | "delivered" | "failed" | "dead";
  responseCode: number | null;
  responseBody: string | null;
  error: string | null;
  scheduledFor: string;
  deliveredAt: string | null;
}

export const MAX_ATTEMPTS = 8;
export const PAUSE_AFTER_FAILURES = 20;

/** Backoff between attempts: 1s, 2s, 4s … capped at an hour. */
export function backoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), 3_600_000);
}

/** Body signature so the receiver can verify it came from us. */
export function sign(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifySignature(body: string, secret: string, timestamp: number, signature: string): boolean {
  const expected = sign(body, secret, timestamp);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export interface Transport {
  post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }>;
}

export class WebhookDispatcher {
  private subscriptions = new Map<string, WebhookSubscription>();
  private queue: Delivery[] = [];
  private deadLetters: Delivery[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly now: () => number = () => Date.now(),
  ) {}

  subscribe(url: string, topics: EventName[], secret: string): WebhookSubscription {
    const subscription: WebhookSubscription = {
      id: randomUUID(),
      url,
      topics,
      secret,
      active: true,
      failureCount: 0,
      createdAt: new Date(this.now()).toISOString(),
      lastDeliveredAt: null,
    };

    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  unsubscribe(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  list(): WebhookSubscription[] {
    return [...this.subscriptions.values()];
  }

  /** Queue a delivery to every subscriber of this topic. */
  enqueue(envelope: Envelope): Delivery[] {
    const created: Delivery[] = [];

    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active) continue;
      if (!subscription.topics.includes(envelope.name)) continue;

      const delivery: Delivery = {
        id: randomUUID(),
        subscriptionId: subscription.id,
        eventId: envelope.id,
        topic: envelope.name,
        url: subscription.url,
        attempt: 0,
        status: "pending",
        responseCode: null,
        responseBody: null,
        error: null,
        scheduledFor: new Date(this.now()).toISOString(),
        deliveredAt: null,
      };

      this.queue.push(delivery);
      created.push(delivery);
    }

    return created;
  }

  /** Attempt every delivery whose time has come. */
  async flush(envelopes: Map<string, Envelope>): Promise<number> {
    const nowIso = new Date(this.now()).toISOString();
    const due = this.queue.filter((d) => d.status === "pending" && d.scheduledFor <= nowIso);

    let delivered = 0;

    for (const delivery of due) {
      const subscription = this.subscriptions.get(delivery.subscriptionId);
      const envelope = envelopes.get(delivery.eventId);
      if (!subscription || !envelope) continue;

      delivery.attempt += 1;
      const body = JSON.stringify({
        id: envelope.id,
        topic: envelope.name,
        occurredAt: envelope.occurredAt,
        data: envelope.payload,
      });

      const timestamp = Math.floor(this.now() / 1000);

      try {
        const response = await this.transport.post(delivery.url, body, {
          "content-type": "application/json",
          "x-shopfront-topic": envelope.name,
          "x-shopfront-event-id": envelope.id,
          "x-shopfront-timestamp": String(timestamp),
          "x-shopfront-signature": sign(body, subscription.secret, timestamp),
        });

        delivery.responseCode = response.status;
        delivery.responseBody = response.body.slice(0, 2000);

        if (response.status >= 200 && response.status < 300) {
          delivery.status = "delivered";
          delivery.deliveredAt = new Date(this.now()).toISOString();
          subscription.failureCount = 0;
          subscription.lastDeliveredAt = delivery.deliveredAt;
          delivered++;
          continue;
        }

        this.reschedule(delivery, subscription, `HTTP ${response.status}`);
      } catch (err) {
        this.reschedule(delivery, subscription, (err as Error).message);
      }
    }

    this.queue = this.queue.filter((d) => d.status === "pending");
    return delivered;
  }

  private reschedule(delivery: Delivery, subscription: WebhookSubscription, error: string): void {
    delivery.error = error;
    subscription.failureCount += 1;

    if (delivery.attempt >= MAX_ATTEMPTS) {
      delivery.status = "dead";
      this.deadLetters.push(delivery);
      return;
    }

    if (subscription.failureCount >= PAUSE_AFTER_FAILURES) {
      subscription.active = false;
    }

    delivery.scheduledFor = new Date(this.now() + backoffMs(delivery.attempt)).toISOString();
  }

  pending(): Delivery[] {
    return this.queue.filter((d) => d.status === "pending");
  }

  dead(): Delivery[] {
    return [...this.deadLetters];
  }

  /** Put a dead delivery back on the queue. */
  replay(deliveryId: string): boolean {
    const index = this.deadLetters.findIndex((d) => d.id === deliveryId);
    if (index === -1) return false;

    const [delivery] = this.deadLetters.splice(index, 1);
    delivery.status = "pending";
    delivery.attempt = 0;
    delivery.error = null;
    delivery.scheduledFor = new Date(this.now()).toISOString();
    this.queue.push(delivery);
    return true;
  }
}

/** Transport backed by global fetch. */
export class FetchTransport implements Transport {
  constructor(private readonly timeoutMs = 10_000) {}

  async post(url: string, body: string, headers: Record<string, string>) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), this.timeoutMs);

    const response = await fetch(url, {
      method: "POST",
      body,
      headers,
      signal: controller.signal,
    });

    return { status: response.status, body: await response.text() };
  }
}
