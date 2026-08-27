import type { Store } from "./store/repositories";
import type { EventBus } from "./events/bus";
import { expireCards, outstandingLiability, type GiftCard } from "./domain/giftcards";
import { dueContracts, recordFailure, recordSuccess, type Contract } from "./domain/subscriptions";
import { abandonedSessions } from "./domain/checkout";
import { expiringAuthorisations } from "./domain/payment";
import { isLowStock } from "./domain/inventory";
import { type EmailQueue, type EmailSettings, abandonedCart } from "./integrations/email";

/**
 * Scheduled work.
 *
 * Each job is a plain function so it can be run from cron, from a queue
 * worker, or straight from a test.
 */

export interface JobResult {
  name: string;
  processed: number;
  errors: string[];
  tookMs: number;
}

async function run(name: string, body: () => Promise<number> | number): Promise<JobResult> {
  const started = Date.now();
  const errors: string[] = [];
  let processed = 0;

  try {
    processed = await body();
  } catch (err) {
    errors.push((err as Error).message);
  }

  return { name, processed, errors, tookMs: Date.now() - started };
}

/** Delete carts nobody has touched in a fortnight. */
export function sweepExpiredCarts(store: Store): Promise<JobResult> {
  return run("sweep-expired-carts", () => {
    const now = new Date().toISOString();
    const expired = store.carts.expired(now);

    for (const cart of expired) {
      store.carts.remove(cart.id);
    }

    return expired.length;
  });
}

/** Email people who left something in their basket. */
export function sendAbandonedCartEmails(
  store: Store,
  emails: EmailQueue,
  settings: EmailSettings,
  minutesIdle = 60,
): Promise<JobResult> {
  return run("abandoned-cart-emails", () => {
    const sessions = abandonedSessions(store.checkouts.all(), minutesIdle, new Date());
    let queued = 0;

    for (const session of sessions) {
      const cart = store.carts.find(session.cartId);
      if (!cart || cart.lines.length === 0) continue;

      emails.enqueue(abandonedCart(cart, settings, "COMEBACK10"));
      queued++;
    }

    return queued;
  });
}

/** Warn about anything below its reorder point. */
export function checkLowStock(store: Store, bus: EventBus): Promise<JobResult> {
  return run("check-low-stock", () => {
    let flagged = 0;

    for (const variant of store.variants.all()) {
      for (const level of store.inventory.forVariant(variant.id)) {
        if (!isLowStock(level)) continue;

        bus.emit("inventory.low", {
          variantId: variant.id,
          sku: variant.sku,
          available: level.onHand - level.committed,
        });
        flagged++;
      }
    }

    return flagged;
  });
}

/** Capture or void authorisations that are about to lapse. */
export function settleExpiringAuthorisations(store: Store): Promise<JobResult> {
  return run("settle-authorisations", () => {
    const expiring = expiringAuthorisations(store.transactions.all(), 24 * 3600 * 1000, new Date());

    for (const authorisation of expiring) {
      const order = store.orders.find(authorisation.orderId);
      if (!order) continue;
      order.tags.push("authorisation-expiring");
    }

    return expiring.length;
  });
}

/** Zero out gift cards past their expiry. */
export function expireGiftCards(cards: GiftCard[]): Promise<JobResult> {
  return run("expire-gift-cards", () => expireCards(cards, new Date()).length);
}

export interface BillingRunResult extends JobResult {
  succeeded: number;
  failed: number;
}

/** Bill every subscription contract that is due. */
export async function runSubscriptionBilling(
  contracts: Contract[],
  charge: (contract: Contract) => Promise<{ ok: boolean; orderId?: string; errorCode?: string }>,
  on = new Date().toISOString().slice(0, 10),
): Promise<BillingRunResult> {
  const started = Date.now();
  const due = dueContracts(contracts, on);
  const errors: string[] = [];

  let succeeded = 0;
  let failed = 0;

  for (const contract of due) {
    const result = await charge(contract);

    if (result.ok) {
      recordSuccess(contract, result.orderId!, new Date().toISOString());
      succeeded++;
    } else {
      recordFailure(contract, result.errorCode ?? "unknown", new Date().toISOString());
      errors.push(`${contract.id}: ${result.errorCode}`);
      failed++;
    }
  }

  return {
    name: "subscription-billing",
    processed: due.length,
    succeeded,
    failed,
    errors,
    tookMs: Date.now() - started,
  };
}

/** Rebuild the automatic collections. */
export function refreshCollections(store: Store): Promise<JobResult> {
  return run("refresh-collections", () => {
    let refreshed = 0;

    for (const collection of store.collections.all()) {
      if (collection.manual) continue;
      refreshed++;
    }

    return refreshed;
  });
}

export interface Schedule {
  name: string;
  cron: string;
  job: () => Promise<JobResult>;
}

/** The default schedule, wired up at boot. */
export function defaultSchedule(store: Store, bus: EventBus, emails: EmailQueue, settings: EmailSettings): Schedule[] {
  return [
    { name: "sweep-expired-carts", cron: "0 3 * * *", job: () => sweepExpiredCarts(store) },
    { name: "abandoned-cart-emails", cron: "*/30 * * * *", job: () => sendAbandonedCartEmails(store, emails, settings) },
    { name: "check-low-stock", cron: "0 7 * * *", job: () => checkLowStock(store, bus) },
    { name: "settle-authorisations", cron: "0 * * * *", job: () => settleExpiringAuthorisations(store) },
    { name: "refresh-collections", cron: "0 4 * * *", job: () => refreshCollections(store) },
  ];
}
