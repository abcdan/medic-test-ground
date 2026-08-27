import { randomUUID } from "node:crypto";
import { type Money, add, subtract, sumAll, zero, greaterThan } from "./money";
import type { Order } from "./order";

/**
 * Payments.
 *
 * The platform models an authorise/capture/refund lifecycle. Gateways
 * that only support a single "sale" call are represented as an authorise
 * immediately followed by a capture.
 */

export type TransactionKind = "authorisation" | "capture" | "sale" | "refund" | "void";
export type TransactionStatus = "pending" | "success" | "failure" | "error";

export interface Transaction {
  id: string;
  orderId: string;
  kind: TransactionKind;
  status: TransactionStatus;
  amount: Money;
  gateway: string;
  /** The gateway's own id, used for reconciliation. */
  gatewayReference: string | null;
  /** Links a capture back to its authorisation. */
  parentId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Raw gateway payload, kept for support. */
  payload: Record<string, unknown>;
  createdAt: string;
  /** An authorisation lapses after this. */
  expiresAt: string | null;
}

export interface PaymentMethod {
  id: string;
  customerId: string;
  gateway: string;
  token: string;
  brand: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  billingPostalCode: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface GatewayRequest {
  orderId: string;
  amount: Money;
  currency: string;
  /** Vaulted token or a one-time nonce from the client. */
  paymentToken: string;
  customerEmail: string;
  /** Stops a retry from charging twice. */
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface GatewayResponse {
  success: boolean;
  reference: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  raw: Record<string, unknown>;
}

export interface Gateway {
  name: string;
  authorise(request: GatewayRequest): Promise<GatewayResponse>;
  capture(reference: string, amount: Money): Promise<GatewayResponse>;
  refund(reference: string, amount: Money): Promise<GatewayResponse>;
  void(reference: string): Promise<GatewayResponse>;
}

export class PaymentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

const AUTHORISATION_TTL_DAYS = 7;

function transaction(
  orderId: string,
  kind: TransactionKind,
  amount: Money,
  gateway: string,
  response: GatewayResponse,
  parentId: string | null = null,
): Transaction {
  const now = new Date();
  const expires =
    kind === "authorisation"
      ? new Date(now.getTime() + AUTHORISATION_TTL_DAYS * 24 * 3600 * 1000).toISOString()
      : null;

  return {
    id: randomUUID(),
    orderId,
    kind,
    status: response.success ? "success" : "failure",
    amount,
    gateway,
    gatewayReference: response.reference,
    parentId,
    errorCode: response.errorCode,
    errorMessage: response.errorMessage,
    payload: response.raw,
    createdAt: now.toISOString(),
    expiresAt: expires,
  };
}

/** Reserve funds without taking them. */
export async function authorise(
  order: Order,
  gateway: Gateway,
  paymentToken: string,
  idempotencyKey: string,
): Promise<Transaction> {
  const response = await gateway.authorise({
    orderId: order.id,
    amount: order.total,
    currency: order.currency,
    paymentToken,
    customerEmail: order.email,
    idempotencyKey,
    metadata: { orderName: order.name, market: order.market },
  });

  const tx = transaction(order.id, "authorisation", order.total, gateway.name, response);

  if (!response.success) {
    throw new PaymentError(
      response.errorCode ?? "authorisation_failed",
      response.errorMessage ?? "The payment was declined",
      isRetryable(response.errorCode),
    );
  }

  return tx;
}

/** Take funds previously authorised. */
export async function capture(
  order: Order,
  authorisation: Transaction,
  gateway: Gateway,
  amount?: Money,
): Promise<Transaction> {
  if (authorisation.kind !== "authorisation") {
    throw new PaymentError("bad_parent", "Can only capture an authorisation", false);
  }
  if (!authorisation.gatewayReference) {
    throw new PaymentError("no_reference", "The authorisation has no gateway reference", false);
  }

  const toCapture = amount ?? authorisation.amount;

  if (greaterThan(toCapture, authorisation.amount)) {
    throw new PaymentError("over_capture", "Cannot capture more than was authorised", false);
  }

  const response = await gateway.capture(authorisation.gatewayReference, toCapture);
  return transaction(order.id, "capture", toCapture, gateway.name, response, authorisation.id);
}

/** Give money back. */
export async function refund(
  order: Order,
  captureTx: Transaction,
  gateway: Gateway,
  amount: Money,
  transactions: Transaction[],
): Promise<Transaction> {
  const alreadyRefunded = sumAll(
    transactions
      .filter((t) => t.kind === "refund" && t.status === "success" && t.parentId === captureTx.id)
      .map((t) => t.amount),
    order.currency,
  );

  const remaining = subtract(captureTx.amount, alreadyRefunded);

  if (greaterThan(amount, remaining)) {
    throw new PaymentError("over_refund", "Cannot refund more than was captured", false);
  }

  const response = await gateway.refund(captureTx.gatewayReference!, amount);
  return transaction(order.id, "refund", amount, gateway.name, response, captureTx.id);
}

/** Release an authorisation that will not be captured. */
export async function voidAuthorisation(
  order: Order,
  authorisation: Transaction,
  gateway: Gateway,
): Promise<Transaction> {
  const response = await gateway.void(authorisation.gatewayReference!);
  return transaction(order.id, "void", authorisation.amount, gateway.name, response, authorisation.id);
}

const RETRYABLE_CODES = new Set([
  "network_error",
  "gateway_timeout",
  "issuer_unavailable",
  "processing_error",
  "rate_limited",
]);

export function isRetryable(code: string | null): boolean {
  return code !== null && RETRYABLE_CODES.has(code);
}

/** Sum of successful captures minus refunds. */
export function netPaid(transactions: Transaction[], currency: string): Money {
  const captured = sumAll(
    transactions.filter((t) => (t.kind === "capture" || t.kind === "sale") && t.status === "success").map((t) => t.amount),
    currency,
  );
  const refunded = sumAll(
    transactions.filter((t) => t.kind === "refund" && t.status === "success").map((t) => t.amount),
    currency,
  );
  return subtract(captured, refunded);
}

export function totalAuthorised(transactions: Transaction[], currency: string): Money {
  return sumAll(
    transactions.filter((t) => t.kind === "authorisation" && t.status === "success").map((t) => t.amount),
    currency,
  );
}

/** Authorisations that are about to lapse and need capturing or voiding. */
export function expiringAuthorisations(transactions: Transaction[], within: number, now: Date): Transaction[] {
  const cutoff = new Date(now.getTime() + within).toISOString();

  return transactions.filter(
    (t) =>
      t.kind === "authorisation" &&
      t.status === "success" &&
      t.expiresAt !== null &&
      t.expiresAt < cutoff,
  );
}

/** Mask a card number for display and logs. */
export function maskCard(number: string): string {
  const digits = number.replace(/\D/g, "");
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

/** Luhn check, so an obvious typo never reaches the gateway. */
export function isValidCardNumber(number: string): boolean {
  const digits = number.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;

  let sum = 0;
  let double = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }

  return sum % 10 === 0;
}

export function cardBrand(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (/^4/.test(digits)) return "visa";
  if (/^5[1-5]/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^6(?:011|5)/.test(digits)) return "discover";
  return "unknown";
}

export function isExpired(method: PaymentMethod, now: Date): boolean {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (method.expiryYear < year) return true;
  if (method.expiryYear === year && method.expiryMonth < month) return true;
  return false;
}

/**
 * Simple in-memory gateway used by the tests and the sandbox
 * environment. Card numbers ending in 0002 always decline.
 */
export class SandboxGateway implements Gateway {
  readonly name = "sandbox";
  private references = new Map<string, Money>();

  async authorise(request: GatewayRequest): Promise<GatewayResponse> {
    if (request.paymentToken.endsWith("0002")) {
      return {
        success: false,
        reference: null,
        errorCode: "card_declined",
        errorMessage: "The card was declined",
        raw: { token: request.paymentToken },
      };
    }

    const reference = `sbx_${randomUUID().slice(0, 12)}`;
    this.references.set(reference, request.amount);
    return { success: true, reference, errorCode: null, errorMessage: null, raw: {} };
  }

  async capture(reference: string, amount: Money): Promise<GatewayResponse> {
    if (!this.references.has(reference)) {
      return { success: false, reference, errorCode: "unknown_reference", errorMessage: "No such authorisation", raw: {} };
    }
    return { success: true, reference, errorCode: null, errorMessage: null, raw: { captured: amount.amount } };
  }

  async refund(reference: string, amount: Money): Promise<GatewayResponse> {
    return { success: true, reference, errorCode: null, errorMessage: null, raw: { refunded: amount.amount } };
  }

  async void(reference: string): Promise<GatewayResponse> {
    this.references.delete(reference);
    return { success: true, reference, errorCode: null, errorMessage: null, raw: {} };
  }
}
