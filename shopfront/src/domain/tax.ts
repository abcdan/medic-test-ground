import { type Money, add, money, sumAll, zero, allocateByWeight } from "./money";

/**
 * Tax calculation.
 *
 * Rates are looked up by destination and tax code. Prices can be stored
 * tax inclusive (the EU norm) or exclusive (the US norm); the engine
 * always reports both the net and the tax so an invoice can show either.
 */

export interface TaxRate {
  id: string;
  /** ISO country code, or "*" for the default. */
  country: string;
  /** State or province, or "*" for the whole country. */
  region: string;
  /** Product tax code this rate applies to, or "*". */
  taxCode: string;
  name: string;
  percent: number;
  /** Stack on top of another rate rather than replacing it, e.g. state + city. */
  compound: boolean;
  priority: number;
}

export interface TaxAddress {
  countryCode: string;
  regionCode: string;
  postalCode: string;
}

export interface TaxSettings {
  /** Displayed prices already contain tax. */
  pricesIncludeTax: boolean;
  /** Charge tax on shipping. */
  taxShipping: boolean;
  /** Tax code used for shipping when taxShipping is on. */
  shippingTaxCode: string;
  /** Business customers with a valid VAT id are zero rated. */
  reverseChargeEnabled: boolean;
  /** Where the shop is established, for reverse charge decisions. */
  originCountry: string;
}

export interface TaxLine {
  name: string;
  percent: number;
  amount: Money;
  compound: boolean;
}

export interface TaxedAmount {
  net: Money;
  tax: Money;
  gross: Money;
  lines: TaxLine[];
}

/** Rates that apply to a destination and tax code, most specific first. */
export function findRates(rates: TaxRate[], address: TaxAddress, taxCode: string): TaxRate[] {
  const matches = rates.filter((rate) => {
    if (rate.country !== "*" && rate.country !== address.countryCode) return false;
    if (rate.region !== "*" && rate.region !== address.regionCode) return false;
    if (rate.taxCode !== "*" && rate.taxCode !== taxCode) return false;
    return true;
  });

  return matches.sort((a, b) => a.priority - b.priority);
}

/** Combined percentage for a set of rates, honouring compounding. */
export function effectiveRate(rates: TaxRate[]): number {
  let multiplier = 1;
  let flat = 0;

  for (const rate of rates) {
    if (rate.compound) {
      multiplier *= 1 + rate.percent / 100;
    } else {
      flat += rate.percent;
    }
  }

  return (multiplier - 1) * 100 + flat;
}

/**
 * Work out the tax on an amount.
 *
 * `amount` is gross when the shop stores tax-inclusive prices, net
 * otherwise.
 */
export function calculate(
  amount: Money,
  rates: TaxRate[],
  settings: TaxSettings,
): TaxedAmount {
  if (rates.length === 0) {
    return { net: amount, tax: zero(amount.currency), gross: amount, lines: [] };
  }

  const combined = effectiveRate(rates);

  const net = settings.pricesIncludeTax
    ? money(amount.amount / (1 + combined / 100), amount.currency)
    : amount;

  const lines: TaxLine[] = rates.map((rate) => ({
    name: rate.name,
    percent: rate.percent,
    amount: money((net.amount * rate.percent) / 100, amount.currency),
    compound: rate.compound,
  }));

  const tax = sumAll(lines.map((line) => line.amount), amount.currency);

  return { net, tax, gross: add(net, tax), lines };
}

/** Zero rated: the customer accounts for the tax in their own return. */
export function reverseCharge(amount: Money, settings: TaxSettings, address: TaxAddress, vatId: string | null): boolean {
  if (!settings.reverseChargeEnabled) return false;
  if (!vatId) return false;
  return address.countryCode !== settings.originCountry;
}

/** Spread an order level discount across the tax lines it affects. */
export function apportionDiscount(discount: Money, taxable: Money[]): Money[] {
  if (taxable.length === 0) return [];
  return allocateByWeight(discount, taxable.map((t) => t.amount));
}

export interface TaxSummaryRow {
  name: string;
  percent: number;
  net: Money;
  tax: Money;
}

/** Group tax lines by rate for the invoice footer. */
export function summarise(taxed: TaxedAmount[], currency: string): TaxSummaryRow[] {
  const byRate = new Map<string, TaxSummaryRow>();

  for (const item of taxed) {
    for (const line of item.lines) {
      const key = `${line.name}@${line.percent}`;
      const existing = byRate.get(key);

      if (existing) {
        existing.net = add(existing.net, item.net);
        existing.tax = add(existing.tax, line.amount);
      } else {
        byRate.set(key, { name: line.name, percent: line.percent, net: item.net, tax: line.amount });
      }
    }
  }

  return [...byRate.values()].sort((a, b) => b.percent - a.percent);
}

/** Loose structural check on an EU VAT identification number. */
export function looksLikeVatId(value: string): boolean {
  return /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(value.replace(/[\s.-]/g, "").toUpperCase());
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  pricesIncludeTax: true,
  taxShipping: true,
  shippingTaxCode: "shipping",
  reverseChargeEnabled: true,
  originCountry: "NL",
};

export const DEFAULT_RATES: TaxRate[] = [
  { id: "nl-standard", country: "NL", region: "*", taxCode: "*", name: "BTW", percent: 21, compound: false, priority: 1 },
  { id: "nl-reduced", country: "NL", region: "*", taxCode: "reduced", name: "BTW laag", percent: 9, compound: false, priority: 1 },
  { id: "de-standard", country: "DE", region: "*", taxCode: "*", name: "MwSt", percent: 19, compound: false, priority: 1 },
  { id: "fr-standard", country: "FR", region: "*", taxCode: "*", name: "TVA", percent: 20, compound: false, priority: 1 },
  { id: "gb-standard", country: "GB", region: "*", taxCode: "*", name: "VAT", percent: 20, compound: false, priority: 1 },
  { id: "us-ca-state", country: "US", region: "CA", taxCode: "*", name: "CA state tax", percent: 6, compound: false, priority: 1 },
  { id: "us-ca-county", country: "US", region: "CA", taxCode: "*", name: "County tax", percent: 1.25, compound: true, priority: 2 },
];
