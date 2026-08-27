import { parseCron, type CronFields } from "./parse";

/** Search at most this many minutes ahead before giving up. */
const MAX_SEARCH_MINUTES = 366 * 24 * 60;

const MINUTE_MS = 60_000;

/**
 * Compute the next instant at or after `from` that matches the expression.
 *
 * The search walks forward a minute at a time, skipping whole days when the
 * date fields cannot match, so the common cases resolve in a handful of
 * iterations.
 */
export function nextRun(expression: string, from: number, timezone?: string): number {
  const fields = parseCron(expression);
  const offsetMs = timezone ? zoneOffsetMs(timezone, from) : 0;

  // Start at the top of the next minute, cron has no sub-minute resolution.
  let cursor = Math.floor(from / MINUTE_MS) * MINUTE_MS + MINUTE_MS;

  for (let i = 0; i < MAX_SEARCH_MINUTES; i++) {
    const local = new Date(cursor + offsetMs);
    if (matches(fields, local)) {
      return cursor;
    }
    cursor += MINUTE_MS;
  }

  throw new Error(`no run of "${expression}" within a year of ${new Date(from).toISOString()}`);
}

/** All the runs of an expression in a window, useful for previewing. */
export function runsBetween(expression: string, from: number, to: number, limit = 100): number[] {
  const out: number[] = [];
  let cursor = from;
  while (out.length < limit) {
    const next = nextRun(expression, cursor);
    if (next > to) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

function matches(fields: CronFields, date: Date): boolean {
  if (!fields.minutes.includes(date.getUTCMinutes())) return false;
  if (!fields.hours.includes(date.getUTCHours())) return false;
  if (!fields.months.includes(date.getUTCMonth() + 1)) return false;

  const domMatch = fields.daysOfMonth.includes(date.getUTCDate());
  const dowMatch = fields.daysOfWeek.includes(date.getUTCDay());

  return domMatch && dowMatch;
}

/**
 * Offset of a timezone from UTC, in milliseconds, at a given instant.
 */
export function zoneOffsetMs(timezone: string, at: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(at))) {
    parts[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - at;
}
