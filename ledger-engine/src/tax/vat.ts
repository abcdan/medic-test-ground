import { Money } from "../money";

/**
 * VAT calculation.
 *
 * Rates are per country and category. Reverse charge shifts the liability
 * to the customer: no VAT is charged, but the transaction still has to be
 * reported on both sides.
 */

export type VatCategory = "standard" | "reduced" | "zero" | "exempt";

export interface VatRate {
  country: string;
  category: VatCategory;
  /** Percentage, e.g. 21 for 21%. */
  percent: number;
  validFrom: string;
}

export const RATES: VatRate[] = [
  { country: "NL", category: "standard", percent: 21, validFrom: "2012-10-01" },
  { country: "NL", category: "reduced", percent: 9, validFrom: "2019-01-01" },
  { country: "NL", category: "zero", percent: 0, validFrom: "2000-01-01" },
  { country: "DE", category: "standard", percent: 19, validFrom: "2007-01-01" },
  { country: "DE", category: "reduced", percent: 7, validFrom: "2007-01-01" },
  { country: "FR", category: "standard", percent: 20, validFrom: "2014-01-01" },
  { country: "FR", category: "reduced", percent: 10, validFrom: "2014-01-01" },
  { country: "BE", category: "standard", percent: 21, validFrom: "1996-01-01" },
  { country: "ES", category: "standard", percent: 21, validFrom: "2012-09-01" },
  { country: "IT", category: "standard", percent: 22, validFrom: "2013-10-01" },
];

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
]);

export function isEu(country: string): boolean {
  return EU_COUNTRIES.has(country.toUpperCase());
}

export function rateFor(country: string, category: VatCategory, onDate: string): number {
  if (category === "exempt") return 0;

  const candidates = RATES.filter(
    (r) => r.country === country.toUpperCase() && r.category === category && r.validFrom <= onDate,
  ).sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  if (candidates.length === 0) {
    throw new Error(`no ${category} VAT rate for ${country} on ${onDate}`);
  }
  return candidates[0].percent;
}

export interface VatBreakdown {
  net: Money;
  vat: Money;
  gross: Money;
  percent: number;
  reverseCharge: boolean;
}

/** VAT on top of a net amount. */
export function addVat(net: Money, percent: number): VatBreakdown {
  const vat = net.times(percent / 100);
  return { net, vat, gross: net.plus(vat), percent, reverseCharge: false };
}

/** Back out the VAT contained in a gross amount. */
export function extractVat(gross: Money, percent: number): VatBreakdown {
  const vat = gross.times(percent / (100 + percent));
  return { net: gross.minus(vat), vat, gross, percent, reverseCharge: false };
}

export interface InvoiceContext {
  supplierCountry: string;
  customerCountry: string;
  /** Present and valid for a B2B customer. */
  customerVatNumber?: string;
  category: VatCategory;
  date: string;
}

/**
 * Work out what VAT applies to a cross border sale.
 *
 * Domestic sales carry the local rate. Intra-EU B2B sales with a valid VAT
 * number are reverse charged. Sales outside the EU are zero rated.
 */
export function assess(net: Money, ctx: InvoiceContext): VatBreakdown {
  const supplier = ctx.supplierCountry.toUpperCase();
  const customer = ctx.customerCountry.toUpperCase();

  if (supplier === customer) {
    return addVat(net, rateFor(supplier, ctx.category, ctx.date));
  }

  if (isEu(customer) && ctx.customerVatNumber) {
    return { net, vat: Money.zero(net.currencyCode), gross: net, percent: 0, reverseCharge: true };
  }

  if (isEu(customer)) {
    return addVat(net, rateFor(customer, ctx.category, ctx.date));
  }

  return { net, vat: Money.zero(net.currencyCode), gross: net, percent: 0, reverseCharge: false };
}

/** Very loose structural check on a VAT number. */
export function looksLikeVatNumber(value: string): boolean {
  return /^[A-Z]{2}[0-9A-Z]{8,12}$/.test(value.toUpperCase().replace(/[\s.]/g, ""));
}

export interface VatReturnLine {
  box: string;
  description: string;
  amount: Money;
}

/** Summarise a set of breakdowns into the boxes of a VAT return. */
export function vatReturn(sales: VatBreakdown[], purchases: VatBreakdown[], currencyCode: string): VatReturnLine[] {
  const zero = Money.zero(currencyCode);
  const add = (a: Money, b: Money) => a.plus(b);

  const outputVat = sales.filter((s) => !s.reverseCharge).map((s) => s.vat).reduce(add, zero);
  const inputVat = purchases.map((p) => p.vat).reduce(add, zero);
  const reverseChargeSales = sales.filter((s) => s.reverseCharge).map((s) => s.net).reduce(add, zero);

  return [
    { box: "1a", description: "Sales, standard rate", amount: outputVat },
    { box: "3b", description: "Intra-EU supplies (reverse charged)", amount: reverseChargeSales },
    { box: "5b", description: "Input VAT reclaimed", amount: inputVat },
    { box: "5c", description: "Net VAT payable", amount: outputVat.minus(inputVat) },
  ];
}
