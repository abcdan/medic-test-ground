import type { RetryPolicy } from "./types";

/**
 * Delay before attempt `attempt` (1-based: attempt 1 is the first retry).
 *
 * Exponential with a configurable factor, clamped to maxDelayMs, then
 * spread by up to `jitter` either side so a thundering herd of failures
 * does not all retry at the same instant.
 */
export function backoffMs(policy: RetryPolicy, attempt: number, random: () => number = Math.random): number {
  const exponential = policy.baseDelayMs * Math.pow(policy.factor, attempt - 1);
  const clamped = Math.min(exponential, policy.maxDelayMs);
  const spread = clamped * policy.jitter;
  return Math.round(clamped - spread + random() * spread * 2);
}

/** True when another attempt is allowed. */
export function shouldRetry(policy: RetryPolicy, attempt: number): boolean {
  return attempt < policy.maxAttempts;
}

/** Total worst case time spent retrying, for capacity planning. */
export function worstCaseTotalMs(policy: RetryPolicy): number {
  let total = 0;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    total += Math.min(policy.baseDelayMs * Math.pow(policy.factor, attempt - 1), policy.maxDelayMs);
  }
  return total;
}
