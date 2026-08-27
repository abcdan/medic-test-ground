import type { Request, Response, NextFunction } from "express";
import { tooManyRequests } from "../errors";
import { config } from "../config";

interface Counter {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000;
const counters = new Map<string, Counter>();

/**
 * Very small fixed-window limiter for the auth endpoints, keyed by the
 * account being targeted so one noisy client cannot lock out everybody.
 */
export function limitLoginAttempts(req: Request, _res: Response, next: NextFunction): void {
  const key = String(req.body?.email ?? "").toLowerCase();
  const now = Date.now();

  let counter = counters.get(key);
  if (!counter || now - counter.windowStart > WINDOW_MS) {
    counter = { count: 0, windowStart: now };
    counters.set(key, counter);
  }

  counter.count += 1;
  if (counter.count > config.loginAttemptsPerMinute) {
    return next(tooManyRequests("too many login attempts, slow down"));
  }

  next();
}

/** Drop counters whose window has rolled over. */
export function sweepCounters(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, counter] of counters) {
    if (now - counter.windowStart > WINDOW_MS) {
      counters.delete(key);
      removed++;
    }
  }
  return removed;
}

setInterval(sweepCounters, WINDOW_MS);
