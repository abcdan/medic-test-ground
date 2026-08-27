import { type Money, money, multiply, percentOf, subtract, zero, lessThan } from "./money";
import type { Variant } from "./catalog";

/**
 * Price resolution.
 *
 * A variant carries a list price. Price lists override it per customer
 * group, market or contract, and quantity breaks discount at volume.
 */

export interface PriceList {
  id: string;
  name: string;
  currency: string;
  /** Higher wins when several lists apply. */
  priority: number;
  /** Applies only to these customer groups; empty means everyone. */
  customerGroups: string[];
  /** Applies only in these markets; empty means everywhere. */
  markets: string[];
  activeFrom: string | null;
  activeTo: string | null;
  entries: PriceListEntry[];
}

export interface PriceListEntry {
  variantId: string;
  price: Money;
  /** Quantity breaks, cheapest tier last. */
  breaks: QuantityBreak[];
}

export interface QuantityBreak {
  minQuantity: number;
  price: Money;
}

export interface PricingContext {
  customerGroups: string[];
  market: string;
  currency: string;
  at: string;
  /** Prices shown to the shopper already include tax. */
  taxInclusive: boolean;
}

export interface ResolvedPrice {
  unitPrice: Money;
  listPrice: Money;
  source: "variant" | "price-list" | "quantity-break";
  priceListId: string | null;
}

function isActive(list: PriceList, at: string): boolean {
  if (list.activeFrom && list.activeFrom > at) return false;
  if (list.activeTo && list.activeTo < at) return false;
  return true;
}

function applies(list: PriceList, ctx: PricingContext): boolean {
  if (!isActive(list, ctx.at)) return false;
  if (list.currency !== ctx.currency) return false;
  if (list.markets.length > 0 && !list.markets.includes(ctx.market)) return false;
  if (list.customerGroups.length > 0) {
    return list.customerGroups.some((group) => ctx.customerGroups.includes(group));
  }
  return true;
}

/** Work out what one unit costs in this context. */
export function resolvePrice(
  variant: Variant,
  quantity: number,
  lists: PriceList[],
  ctx: PricingContext,
): ResolvedPrice {
  const candidates = lists
    .filter((list) => applies(list, ctx))
    .sort((a, b) => b.priority - a.priority);

  for (const list of candidates) {
    const entry = list.entries.find((e) => e.variantId === variant.id);
    if (!entry) continue;

    const tier = [...entry.breaks]
      .sort((a, b) => a.minQuantity - b.minQuantity)
      .filter((b) => b.minQuantity <= quantity)
      .pop();

    if (tier) {
      return {
        unitPrice: tier.price,
        listPrice: variant.price,
        source: "quantity-break",
        priceListId: list.id,
      };
    }

    return { unitPrice: entry.price, listPrice: variant.price, source: "price-list", priceListId: list.id };
  }

  return { unitPrice: variant.price, listPrice: variant.price, source: "variant", priceListId: null };
}

/** Cheapest price across every list that applies, for a "from" badge. */
export function bestPrice(variant: Variant, lists: PriceList[], ctx: PricingContext): Money {
  let best = variant.price;

  for (const list of lists.filter((l) => applies(l, ctx))) {
    const entry = list.entries.find((e) => e.variantId === variant.id);
    if (entry && lessThan(entry.price, best)) best = entry.price;
    for (const tier of entry?.breaks ?? []) {
      if (lessThan(tier.price, best)) best = tier.price;
    }
  }

  return best;
}

/** Strip tax out of a tax-inclusive price. */
export function exclusiveOf(price: Money, taxRatePercent: number): Money {
  return money(price.amount / (1 + taxRatePercent / 100), price.currency);
}

/** Add tax to a tax-exclusive price. */
export function inclusiveOf(price: Money, taxRatePercent: number): Money {
  return money(price.amount * (1 + taxRatePercent / 100), price.currency);
}

/** Round a price to a psychological ending, e.g. .99 or .95. */
export function roundToEnding(price: Money, ending: number): Money {
  const majorUnits = Math.floor(price.amount / 100);
  return money(majorUnits * 100 + ending, price.currency);
}

/** Convert a price into another currency and round it up to a tidy value. */
export function convertAndRound(price: Money, rate: number, targetCurrency: string): Money {
  const converted = Math.ceil((price.amount * rate) / 100) * 100;
  return money(converted, targetCurrency);
}

export interface MarginReport {
  variantId: string;
  price: Money;
  cost: Money;
  margin: Money;
  marginPercent: number;
}

export function marginReport(variant: Variant, price: Money): MarginReport {
  const cost = variant.costPrice ?? zero(price.currency);
  const margin = subtract(price, cost);
  return {
    variantId: variant.id,
    price,
    cost,
    margin,
    marginPercent: Math.round((margin.amount / price.amount) * 100),
  };
}

/** Bulk reprice: apply a percentage change to a set of variants. */
export function repriceBy(variants: Variant[], percentChange: number): Map<string, Money> {
  const out = new Map<string, Money>();
  for (const variant of variants) {
    out.set(variant.id, multiply(variant.price, 1 + percentChange / 100));
  }
  return out;
}

/** Apply a markdown, keeping the old price as the compare-at. */
export function markdown(variant: Variant, percentOff: number): { price: Money; compareAtPrice: Money } {
  return {
    price: subtract(variant.price, percentOf(variant.price, percentOff)),
    compareAtPrice: variant.price,
  };
}
