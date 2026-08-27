/**
 * Money as integer minor units.
 *
 * Every price, tax, discount and shipping figure in the platform is a
 * `Money`. Mixing currencies throws rather than silently producing a
 * wrong total.
 */

export interface CurrencyInfo {
  code: string;
  exponent: number;
  symbol: string;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  EUR: { code: "EUR", exponent: 2, symbol: "€" },
  USD: { code: "USD", exponent: 2, symbol: "$" },
  GBP: { code: "GBP", exponent: 2, symbol: "£" },
  SEK: { code: "SEK", exponent: 2, symbol: "kr" },
  PLN: { code: "PLN", exponent: 2, symbol: "zł" },
  JPY: { code: "JPY", exponent: 0, symbol: "¥" },
};

export interface Money {
  readonly amount: number;
  readonly currency: string;
}

export function money(amount: number, currency = "EUR"): Money {
  return { amount: Math.round(amount), currency: currency.toUpperCase() };
}

export function fromMajor(amount: number, currency = "EUR"): Money {
  const info = CURRENCIES[currency.toUpperCase()];
  if (!info) throw new Error(`unknown currency ${currency}`);
  return money(amount * Math.pow(10, info.exponent), currency);
}

export function zero(currency = "EUR"): Money {
  return { amount: 0, currency: currency.toUpperCase() };
}

function same(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  same(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  same(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function multiply(a: Money, factor: number): Money {
  return { amount: Math.round(a.amount * factor), currency: a.currency };
}

export function divide(a: Money, divisor: number): Money {
  if (divisor === 0) throw new Error("division by zero");
  return { amount: Math.round(a.amount / divisor), currency: a.currency };
}

export function negate(a: Money): Money {
  return { amount: -a.amount, currency: a.currency };
}

export function abs(a: Money): Money {
  return { amount: Math.abs(a.amount), currency: a.currency };
}

export function isZero(a: Money): boolean {
  return a.amount === 0;
}

export function isPositive(a: Money): boolean {
  return a.amount > 0;
}

export function isNegative(a: Money): boolean {
  return a.amount < 0;
}

export function compare(a: Money, b: Money): number {
  same(a, b);
  return a.amount - b.amount;
}

export function greaterThan(a: Money, b: Money): boolean {
  return compare(a, b) > 0;
}

export function lessThan(a: Money, b: Money): boolean {
  return compare(a, b) < 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.amount === b.amount && a.currency === b.currency;
}

export function maxOf(a: Money, b: Money): Money {
  return greaterThan(a, b) ? a : b;
}

export function minOf(a: Money, b: Money): Money {
  return lessThan(a, b) ? a : b;
}

/** Clamp to zero so a discount cannot make a line negative. */
export function floorAtZero(a: Money): Money {
  return a.amount < 0 ? zero(a.currency) : a;
}

export function sumAll(items: Money[], currency = "EUR"): Money {
  if (items.length === 0) return zero(currency);
  return items.reduce((acc, item) => add(acc, item));
}

/** Percentage of an amount, e.g. percentOf(price, 20) for 20%. */
export function percentOf(a: Money, percent: number): Money {
  return multiply(a, percent / 100);
}

/**
 * Split into n parts that sum back to the original, spreading the
 * remainder across the first parts.
 */
export function allocate(a: Money, n: number): Money[] {
  if (n <= 0) throw new Error("allocate needs a positive count");
  const base = Math.floor(a.amount / n);
  const remainder = a.amount - base * n;

  return Array.from({ length: n }, (_, i) => ({
    amount: base + (i < remainder ? 1 : 0),
    currency: a.currency,
  }));
}

/** Split by weights, giving any drift to the largest weight. */
export function allocateByWeight(a: Money, weights: number[]): Money[] {
  const total = weights.reduce((x, y) => x + y, 0);
  if (total <= 0) throw new Error("weights must sum to a positive number");

  const parts = weights.map((weight) => Math.round((a.amount * weight) / total));
  const drift = a.amount - parts.reduce((x, y) => x + y, 0);

  if (drift !== 0) {
    const biggest = weights.indexOf(Math.max(...weights));
    parts[biggest] += drift;
  }

  return parts.map((amount) => ({ amount, currency: a.currency }));
}

export function format(a: Money): string {
  const info = CURRENCIES[a.currency] ?? { exponent: 2, symbol: a.currency };
  return `${info.symbol}${(a.amount / Math.pow(10, info.exponent)).toFixed(info.exponent)}`;
}

export function toMajor(a: Money): number {
  const info = CURRENCIES[a.currency];
  return a.amount / Math.pow(10, info ? info.exponent : 2);
}
