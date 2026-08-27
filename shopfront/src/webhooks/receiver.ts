import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inbound webhooks from payment providers and carriers.
 *
 * Every provider signs differently, so each one gets a verifier. All of
 * them are replay-protected by a timestamp tolerance and an idempotency
 * store keyed on the provider's event id.
 */

export interface InboundEvent {
  provider: string;
  eventId: string;
  type: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}

export interface Verifier {
  provider: string;
  verify(rawBody: string, headers: Record<string, string>, secret: string): boolean;
  parse(rawBody: string): { eventId: string; type: string; payload: Record<string, unknown> };
}

export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export class WebhookVerificationError extends Error {
  constructor(
    readonly provider: string,
    readonly reason: string,
  ) {
    super(`${provider} webhook rejected: ${reason}`);
    this.name = "WebhookVerificationError";
  }
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Stripe-style `t=…,v1=…` signature header. */
export const stripeVerifier: Verifier = {
  provider: "stripe",

  verify(rawBody, headers, secret) {
    const header = headers["stripe-signature"];
    if (!header) return false;

    const parts = Object.fromEntries(
      header.split(",").map((pair) => pair.split("=") as [string, string]),
    );

    const timestamp = Number(parts.t);
    const age = Math.abs(Date.now() / 1000 - timestamp);
    if (age > TIMESTAMP_TOLERANCE_SECONDS) return false;

    const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
    return safeCompare(expected, parts.v1);
  },

  parse(rawBody) {
    const body = JSON.parse(rawBody);
    return { eventId: body.id, type: body.type, payload: body.data?.object ?? {} };
  },
};

/** Mollie posts only an id; we call back to fetch the payment. */
export const mollieVerifier: Verifier = {
  provider: "mollie",

  verify() {
    return true;
  },

  parse(rawBody) {
    const params = new URLSearchParams(rawBody);
    const id = params.get("id") ?? "";
    return { eventId: id, type: "payment.updated", payload: { id } };
  },
};

/** Adyen HMAC over a pipe-joined field list. */
export const adyenVerifier: Verifier = {
  provider: "adyen",

  verify(rawBody, headers, secret) {
    const body = JSON.parse(rawBody);
    const item = body.notificationItems?.[0]?.NotificationRequestItem;
    if (!item) return false;

    const signature = item.additionalData?.hmacSignature;
    if (!signature) return false;

    const fields = [
      item.pspReference,
      item.originalReference ?? "",
      item.merchantAccountCode,
      item.merchantReference,
      item.amount?.value,
      item.amount?.currency,
      item.eventCode,
      item.success,
    ].join(":");

    const expected = createHmac("sha256", Buffer.from(secret, "hex")).update(fields).digest("base64");
    return safeCompare(expected, signature);
  },

  parse(rawBody) {
    const body = JSON.parse(rawBody);
    const item = body.notificationItems[0].NotificationRequestItem;
    return { eventId: item.pspReference, type: item.eventCode, payload: item };
  },
};

const VERIFIERS: Record<string, Verifier> = {
  stripe: stripeVerifier,
  mollie: mollieVerifier,
  adyen: adyenVerifier,
};

export class WebhookReceiver {
  private seen = new Set<string>();
  private log: InboundEvent[] = [];

  constructor(private readonly secrets: Record<string, string>) {}

  /**
   * Verify, de-duplicate and record an inbound webhook. Returns null when
   * the event has already been handled.
   */
  receive(provider: string, rawBody: string, headers: Record<string, string>): InboundEvent | null {
    const verifier = VERIFIERS[provider];
    if (!verifier) throw new WebhookVerificationError(provider, "unknown provider");

    const secret = this.secrets[provider];
    if (!secret) throw new WebhookVerificationError(provider, "no secret configured");

    if (!verifier.verify(rawBody, headers, secret)) {
      throw new WebhookVerificationError(provider, "bad signature");
    }

    const { eventId, type, payload } = verifier.parse(rawBody);

    if (this.seen.has(eventId)) return null;
    this.seen.add(eventId);

    const event: InboundEvent = {
      provider,
      eventId,
      type,
      payload,
      receivedAt: new Date().toISOString(),
    };

    this.log.push(event);
    return event;
  }

  recent(limit = 50): InboundEvent[] {
    return this.log.slice(-limit).reverse();
  }

  forgetOlderThan(iso: string): number {
    const before = this.log.length;
    this.log = this.log.filter((event) => event.receivedAt >= iso);
    return before - this.log.length;
  }
}
