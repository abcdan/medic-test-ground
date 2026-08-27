/**
 * Currency metadata.
 *
 * `exponent` is the number of decimal places the currency subdivides into,
 * so amounts are stored as integers of 10^-exponent units.
 */

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  exponent: number;
}

export const CURRENCIES: Record<string, Currency> = {
  EUR: { code: "EUR", name: "Euro", symbol: "€", exponent: 2 },
  USD: { code: "USD", name: "US Dollar", symbol: "$", exponent: 2 },
  GBP: { code: "GBP", name: "Pound Sterling", symbol: "£", exponent: 2 },
  CHF: { code: "CHF", name: "Swiss Franc", symbol: "CHF", exponent: 2 },
  SEK: { code: "SEK", name: "Swedish Krona", symbol: "kr", exponent: 2 },
  JPY: { code: "JPY", name: "Japanese Yen", symbol: "¥", exponent: 0 },
  KWD: { code: "KWD", name: "Kuwaiti Dinar", symbol: "KD", exponent: 3 },
  BHD: { code: "BHD", name: "Bahraini Dinar", symbol: "BD", exponent: 3 },
};

export class UnknownCurrencyError extends Error {
  constructor(readonly code: string) {
    super(`unknown currency "${code}"`);
    this.name = "UnknownCurrencyError";
  }
}

export function currency(code: string): Currency {
  const found = CURRENCIES[code.toUpperCase()];
  if (!found) throw new UnknownCurrencyError(code);
  return found;
}

export function isKnownCurrency(code: string): boolean {
  return code.toUpperCase() in CURRENCIES;
}

/** How many minor units make up one major unit. */
export function minorUnitsPerMajor(code: string): number {
  return Math.pow(10, currency(code).exponent);
}

export function listCurrencies(): Currency[] {
  return Object.values(CURRENCIES).sort((a, b) => a.code.localeCompare(b.code));
}
