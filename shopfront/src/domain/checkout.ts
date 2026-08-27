import { randomUUID } from "node:crypto";
import { type Money, isZero, subtract, zero } from "./money";
import { type Cart, type CartContext, type CartTotals, computeTotals, validateCart } from "./cart";
import { type Address, type Order, fromCart, recomputeStatuses, toAddress } from "./order";
import {
  type Gateway,
  type Transaction,
  authorise,
  capture,
} from "./payment";
import { type InventoryLevel, commit } from "./inventory";
import type { RateQuote } from "./shipping";

/**
 * Checkout.
 *
 * A session walks the shopper through contact details, delivery, and
 * payment. Committing a session turns the cart into an order, reserves
 * stock and charges the card.
 */

export type CheckoutStep = "contact" | "delivery" | "shipping" | "payment" | "complete";

export interface CheckoutSession {
  id: string;
  cartId: string;
  step: CheckoutStep;
  email: string | null;
  phone: string | null;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  billingSameAsShipping: boolean;
  shippingMethodId: string | null;
  paymentToken: string | null;
  /** Sent to the gateway so a double submit does not double charge. */
  idempotencyKey: string;
  acceptsMarketing: boolean;
  /** Completed sessions cannot be replayed. */
  completedAt: string | null;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export class CheckoutError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly step: CheckoutStep,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

const SESSION_TTL_MINUTES = 60;

export function startSession(cart: Cart): CheckoutSession {
  const now = new Date();

  return {
    id: randomUUID(),
    cartId: cart.id,
    step: "contact",
    email: cart.email,
    phone: null,
    shippingAddress: null,
    billingAddress: null,
    billingSameAsShipping: true,
    shippingMethodId: null,
    paymentToken: null,
    idempotencyKey: randomUUID(),
    acceptsMarketing: false,
    completedAt: null,
    orderId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MINUTES * 60_000).toISOString(),
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function setContact(session: CheckoutSession, email: string, phone: string | null): CheckoutSession {
  if (!EMAIL_RE.test(email)) {
    throw new CheckoutError("bad_email", "That email address does not look right", "contact");
  }

  session.email = email.trim().toLowerCase();
  session.phone = phone;
  session.step = "delivery";
  session.updatedAt = new Date().toISOString();
  return session;
}

const REQUIRED_ADDRESS_FIELDS: (keyof Address)[] = [
  "firstName",
  "lastName",
  "line1",
  "city",
  "postalCode",
  "countryCode",
];

export function validateAddress(address: Address): string[] {
  const missing: string[] = [];

  for (const field of REQUIRED_ADDRESS_FIELDS) {
    if (!address[field]) missing.push(field);
  }

  if (address.countryCode === "US" && !address.regionCode) missing.push("regionCode");
  if (address.countryCode === "CA" && !address.regionCode) missing.push("regionCode");

  return missing;
}

export function setDelivery(session: CheckoutSession, shipping: Partial<Address>, billing?: Partial<Address>): CheckoutSession {
  const address = toAddress(shipping);
  const missing = validateAddress(address);

  if (missing.length > 0) {
    throw new CheckoutError("incomplete_address", `Missing: ${missing.join(", ")}`, "delivery");
  }

  session.shippingAddress = address;
  session.billingSameAsShipping = !billing;
  session.billingAddress = billing ? toAddress(billing) : address;
  session.step = "shipping";
  session.updatedAt = new Date().toISOString();
  return session;
}

export function setShippingMethod(session: CheckoutSession, methodId: string, quotes: RateQuote[]): CheckoutSession {
  if (!quotes.some((quote) => quote.methodId === methodId)) {
    throw new CheckoutError("bad_method", "That delivery option is no longer available", "shipping");
  }

  session.shippingMethodId = methodId;
  session.step = "payment";
  session.updatedAt = new Date().toISOString();
  return session;
}

export function setPayment(session: CheckoutSession, token: string): CheckoutSession {
  session.paymentToken = token;
  session.updatedAt = new Date().toISOString();
  return session;
}

export interface CommitResult {
  order: Order;
  transactions: Transaction[];
  totals: CartTotals;
}

/**
 * Turn the session into an order.
 *
 * Reserves stock, authorises the payment and captures it straight away
 * for the default "charge on order" setting.
 */
export async function commitSession(
  session: CheckoutSession,
  cart: Cart,
  ctx: CartContext,
  gateway: Gateway,
  options: { captureImmediately: boolean } = { captureImmediately: true },
): Promise<CommitResult> {
  if (session.completedAt) {
    throw new CheckoutError("already_completed", "This checkout has already been completed", "payment");
  }
  if (new Date(session.expiresAt) < new Date()) {
    throw new CheckoutError("expired", "This checkout has expired, please start again", "contact");
  }
  if (!session.email) {
    throw new CheckoutError("no_email", "We need an email address", "contact");
  }
  if (!session.paymentToken) {
    throw new CheckoutError("no_payment", "We need payment details", "payment");
  }

  cart.email = session.email;
  cart.selectedShippingMethodId = session.shippingMethodId;
  if (session.shippingAddress) {
    cart.shippingAddress = {
      countryCode: session.shippingAddress.countryCode,
      regionCode: session.shippingAddress.regionCode,
      postalCode: session.shippingAddress.postalCode,
    };
  }

  const problems = validateCart(cart, ctx);
  if (problems.length > 0) {
    throw new CheckoutError("cart_invalid", problems.map((p) => p.message).join("; "), "payment");
  }

  const totals = computeTotals(cart, ctx);
  const quote = ctx.shippingQuotes.find((q) => q.methodId === session.shippingMethodId);

  const order = fromCart(cart, totals, {
    shipping: session.shippingAddress,
    billing: session.billingAddress,
  }, quote?.name ?? null);

  for (const line of cart.lines) {
    const levels = ctx.inventory.get(line.variantId) ?? [];
    if (levels.length > 0) {
      const updated = commit(levels[0], line.quantity);
      levels[0] = updated;
    }
  }

  const transactions: Transaction[] = [];

  if (!isZero(order.total)) {
    const authorisation = await authorise(order, gateway, session.paymentToken, session.idempotencyKey);
    transactions.push(authorisation);

    if (options.captureImmediately) {
      const captureTx = await capture(order, authorisation, gateway);
      transactions.push(captureTx);
      order.paidTotal = captureTx.amount;
    }
  }

  order.status = "open";
  order.confirmedAt = new Date().toISOString();
  recomputeStatuses(order);

  session.completedAt = new Date().toISOString();
  session.orderId = order.id;
  session.step = "complete";

  return { order, transactions, totals };
}

/** Everything the checkout page needs to render in one payload. */
export interface CheckoutView {
  session: CheckoutSession;
  totals: CartTotals;
  shippingQuotes: RateQuote[];
  problems: { lineId: string | null; code: string; message: string }[];
  nextStep: CheckoutStep;
}

export function buildView(session: CheckoutSession, cart: Cart, ctx: CartContext): CheckoutView {
  return {
    session,
    totals: computeTotals(cart, ctx),
    shippingQuotes: ctx.shippingQuotes,
    problems: validateCart(cart, ctx),
    nextStep: session.step,
  };
}

/** Carts abandoned at checkout, for the recovery email. */
export function abandonedSessions(sessions: CheckoutSession[], olderThanMinutes: number, now: Date): CheckoutSession[] {
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000).toISOString();

  return sessions.filter(
    (session) => session.completedAt === null && session.email !== null && session.updatedAt < cutoff,
  );
}
