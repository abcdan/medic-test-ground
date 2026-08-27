import { currency, minorUnitsPerMajor } from "./currency";

/**
 * An amount of money, held as an integer number of minor units.
 *
 * Money is immutable: every operation returns a new value. Operations
 * between different currencies throw, so a mismatch cannot silently
 * produce a wrong number.
 */
export class Money {
  private constructor(
    /** Signed integer count of minor units. */
    readonly amount: number,
    readonly currencyCode: string,
  ) {}

  /** Build from minor units, e.g. cents. */
  static fromMinor(amount: number, currencyCode: string): Money {
    currency(currencyCode);
    return new Money(Math.round(amount), currencyCode.toUpperCase());
  }

  /** Build from major units, e.g. euros. */
  static fromMajor(amount: number, currencyCode: string): Money {
    const factor = minorUnitsPerMajor(currencyCode);
    return new Money(Math.round(amount * factor), currencyCode.toUpperCase());
  }

  /** Parse "1234.56" or "-1,234.56". */
  static parse(input: string, currencyCode: string): Money {
    const cleaned = input.replace(/[,\s]/g, "");
    const value = Number(cleaned);
    if (Number.isNaN(value)) {
      throw new Error(`cannot parse "${input}" as an amount`);
    }
    return Money.fromMajor(value, currencyCode);
  }

  static zero(currencyCode: string): Money {
    return new Money(0, currencyCode.toUpperCase());
  }

  private assertSame(other: Money): void {
    if (other.currencyCode !== this.currencyCode) {
      throw new Error(`currency mismatch: ${this.currencyCode} vs ${other.currencyCode}`);
    }
  }

  plus(other: Money): Money {
    this.assertSame(other);
    return new Money(this.amount + other.amount, this.currencyCode);
  }

  minus(other: Money): Money {
    this.assertSame(other);
    return new Money(this.amount - other.amount, this.currencyCode);
  }

  /** Scale by a plain number, rounding to the nearest minor unit. */
  times(factor: number): Money {
    return new Money(Math.round(this.amount * factor), this.currencyCode);
  }

  /** Divide by a plain number, rounding to the nearest minor unit. */
  dividedBy(divisor: number): Money {
    if (divisor === 0) throw new Error("division by zero");
    return new Money(Math.round(this.amount / divisor), this.currencyCode);
  }

  negate(): Money {
    return new Money(-this.amount, this.currencyCode);
  }

  abs(): Money {
    return new Money(Math.abs(this.amount), this.currencyCode);
  }

  /**
   * Split into n parts that sum back to the original, distributing the
   * remainder one minor unit at a time across the first parts.
   */
  allocate(n: number): Money[] {
    if (n <= 0) throw new Error("allocate needs a positive count");

    const base = Math.floor(this.amount / n);
    const remainder = this.amount - base * n;

    const parts: Money[] = [];
    for (let i = 0; i < n; i++) {
      parts.push(new Money(base + (i < remainder ? 1 : 0), this.currencyCode));
    }
    return parts;
  }

  /** Split by weights, e.g. [1, 1, 2] for a 25/25/50 split. */
  allocateByRatio(weights: number[]): Money[] {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error("weights must sum to a positive number");

    const parts: Money[] = [];
    let allocated = 0;

    for (const weight of weights) {
      const share = Math.round((this.amount * weight) / total);
      parts.push(new Money(share, this.currencyCode));
      allocated += share;
    }

    const drift = this.amount - allocated;
    if (drift !== 0) {
      parts[parts.length - 1] = new Money(parts[parts.length - 1].amount + drift, this.currencyCode);
    }

    return parts;
  }

  isZero(): boolean {
    return this.amount === 0;
  }

  isPositive(): boolean {
    return this.amount > 0;
  }

  isNegative(): boolean {
    return this.amount < 0;
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currencyCode === other.currencyCode;
  }

  compare(other: Money): number {
    this.assertSame(other);
    return this.amount - other.amount;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  /** Value in major units, for display and serialisation only. */
  toMajor(): number {
    return this.amount / minorUnitsPerMajor(this.currencyCode);
  }

  toString(): string {
    const { exponent, symbol } = currency(this.currencyCode);
    return `${symbol}${this.toMajor().toFixed(exponent)}`;
  }

  toJSON(): { amount: number; currency: string } {
    return { amount: this.amount, currency: this.currencyCode };
  }
}

/** Sum a list, which must be non-empty and single-currency. */
export function sum(items: Money[]): Money {
  if (items.length === 0) throw new Error("cannot sum an empty list");
  return items.reduce((acc, m) => acc.plus(m));
}

/** Sum a list that may be empty, given the currency to fall back to. */
export function sumOrZero(items: Money[], currencyCode: string): Money {
  if (items.length === 0) return Money.zero(currencyCode);
  return sum(items);
}

export function max(a: Money, b: Money): Money {
  return a.greaterThan(b) ? a : b;
}

export function min(a: Money, b: Money): Money {
  return a.lessThan(b) ? a : b;
}
