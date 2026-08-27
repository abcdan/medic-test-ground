/**
 * Five field cron parser: minute hour day-of-month month day-of-week.
 *
 * Supports `*`, ranges (`1-5`), lists (`1,3,5`), steps (`*​/15`, `0-30/5`)
 * and the usual three letter month and weekday names. Also accepts the
 * common macros (`@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`).
 */

export interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** True when the day-of-month field was a bare `*`. */
  anyDayOfMonth: boolean;
  /** True when the day-of-week field was a bare `*`. */
  anyDayOfWeek: boolean;
}

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export class CronParseError extends Error {
  constructor(
    readonly expression: string,
    readonly field: string,
    message: string,
  ) {
    super(`invalid cron "${expression}": ${field}: ${message}`);
    this.name = "CronParseError";
  }
}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: string[];
}

const FIELDS: FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTH_NAMES },
  { name: "day-of-week", min: 0, max: 6, names: DAY_NAMES },
];

function parseValue(raw: string, spec: FieldSpec, expression: string): number {
  const lowered = raw.toLowerCase();
  if (spec.names) {
    const index = spec.names.indexOf(lowered);
    if (index >= 0) {
      return spec.name === "month" ? index + 1 : index;
    }
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new CronParseError(expression, spec.name, `"${raw}" is not a number`);
  }
  if (n < spec.min || n > spec.max) {
    throw new CronParseError(expression, spec.name, `${n} is outside ${spec.min}-${spec.max}`);
  }
  return n;
}

function parseField(raw: string, spec: FieldSpec, expression: string): number[] {
  const values = new Set<number>();

  for (const part of raw.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);

    if (!Number.isInteger(step) || step <= 0) {
      throw new CronParseError(expression, spec.name, `bad step "${stepPart}"`);
    }

    let from: number;
    let to: number;

    if (rangePart === "*") {
      from = spec.min;
      to = spec.max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      from = parseValue(a, spec, expression);
      to = parseValue(b, spec, expression);
      if (from > to) {
        throw new CronParseError(expression, spec.name, `range ${rangePart} runs backwards`);
      }
    } else {
      from = parseValue(rangePart, spec, expression);
      to = from;
    }

    for (let v = from; v <= to; v += step) {
      values.add(v);
    }
  }

  return [...values].sort((a, b) => a - b);
}

/** Parse a cron expression into the set of matching values per field. */
export function parseCron(expression: string): CronFields {
  const trimmed = expression.trim();
  const expanded = MACROS[trimmed.toLowerCase()] ?? trimmed;
  const parts = expanded.split(/\s+/);

  if (parts.length !== 5) {
    throw new CronParseError(expression, "expression", `expected 5 fields, got ${parts.length}`);
  }

  const [minute, hour, dom, month, dow] = parts;

  return {
    minutes: parseField(minute, FIELDS[0], expression),
    hours: parseField(hour, FIELDS[1], expression),
    daysOfMonth: parseField(dom, FIELDS[2], expression),
    months: parseField(month, FIELDS[3], expression),
    daysOfWeek: parseField(dow.replace(/^7$/, "0"), FIELDS[4], expression),
    anyDayOfMonth: dom === "*",
    anyDayOfWeek: dow === "*",
  };
}

/** True when the expression parses. */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

/** Render a parsed expression back into something readable. */
export function describeCron(expression: string): string {
  const fields = parseCron(expression);
  const bits: string[] = [];

  bits.push(fields.minutes.length === 60 ? "every minute" : `at minute ${fields.minutes.join(",")}`);
  if (fields.hours.length !== 24) bits.push(`hour ${fields.hours.join(",")}`);
  if (!fields.anyDayOfMonth) bits.push(`day-of-month ${fields.daysOfMonth.join(",")}`);
  if (fields.months.length !== 12) bits.push(`month ${fields.months.join(",")}`);
  if (!fields.anyDayOfWeek) bits.push(`day-of-week ${fields.daysOfWeek.map((d) => DAY_NAMES[d]).join(",")}`);

  return bits.join(", ");
}
