import { Money } from "./money";
import { currency } from "./currency";

/**
 * FX rates and conversion.
 *
 * A rate is quoted as "how many units of `quote` you get for one unit of
 * `base`", so EUR/USD 1.09 means one euro buys 1.09 dollars.
 */
export interface Rate {
  base: string;
  quote: string;
  rate: number;
  /** Date the rate applies to, as YYYY-MM-DD. */
  asOf: string;
  source: string;
}

export class MissingRateError extends Error {
  constructor(
    readonly base: string,
    readonly quote: string,
    readonly asOf: string,
  ) {
    super(`no ${base}/${quote} rate on or before ${asOf}`);
    this.name = "MissingRateError";
  }
}

/** Rate table with per-day history. */
export class RateTable {
  private rates = new Map<string, Rate[]>();

  private static key(base: string, quote: string): string {
    return `${base.toUpperCase()}/${quote.toUpperCase()}`;
  }

  add(rate: Rate): void {
    currency(rate.base);
    currency(rate.quote);
    if (rate.rate <= 0) throw new Error(`rate must be positive, got ${rate.rate}`);

    const key = RateTable.key(rate.base, rate.quote);
    const list = this.rates.get(key) ?? [];
    list.push(rate);
    list.sort((a, b) => a.asOf.localeCompare(b.asOf));
    this.rates.set(key, list);
  }

  addAll(rates: Rate[]): void {
    for (const rate of rates) this.add(rate);
  }

  /** Most recent rate on or before `asOf`. */
  lookup(base: string, quote: string, asOf: string): Rate {
    if (base.toUpperCase() === quote.toUpperCase()) {
      return { base, quote, rate: 1, asOf, source: "identity" };
    }

    const direct = this.rates.get(RateTable.key(base, quote)) ?? [];
    const found = [...direct].reverse().find((r) => r.asOf <= asOf);
    if (found) return found;

    const inverse = this.rates.get(RateTable.key(quote, base)) ?? [];
    const back = [...inverse].reverse().find((r) => r.asOf <= asOf);
    if (back) {
      return { base, quote, rate: 1 / back.rate, asOf: back.asOf, source: `${back.source} (inverted)` };
    }

    throw new MissingRateError(base, quote, asOf);
  }

  has(base: string, quote: string, asOf: string): boolean {
    try {
      this.lookup(base, quote, asOf);
      return true;
    } catch {
      return false;
    }
  }

  all(): Rate[] {
    return [...this.rates.values()].flat();
  }
}

export interface Conversion {
  from: Money;
  to: Money;
  rate: number;
  asOf: string;
}

/** Convert an amount into another currency at the rate for a date. */
export function convert(amount: Money, target: string, table: RateTable, asOf: string): Conversion {
  const rate = table.lookup(amount.currencyCode, target, asOf);

  const sourceExponent = currency(amount.currencyCode).exponent;
  const targetExponent = currency(target).exponent;
  const scale = Math.pow(10, targetExponent - sourceExponent);

  const converted = Money.fromMinor(Math.round(amount.amount * rate.rate * scale), target);

  return { from: amount, to: converted, rate: rate.rate, asOf: rate.asOf };
}

/**
 * Difference between what a foreign balance was booked at and what it is
 * worth now. Positive means a gain.
 */
export function revaluationDelta(
  original: Money,
  bookedRate: number,
  functionalCurrency: string,
  table: RateTable,
  asOf: string,
): Money {
  const bookedValue = Money.fromMinor(Math.round(original.amount * bookedRate), functionalCurrency);
  const currentValue = convert(original, functionalCurrency, table, asOf).to;
  return currentValue.minus(bookedValue);
}
