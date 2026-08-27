import { type Money, add, money, multiply, sumAll, zero, lessThan, greaterThan } from "./money";
import type { Variant } from "./catalog";
import { shippingWeight } from "./catalog";

/**
 * Shipping rates.
 *
 * Zones map destinations to a set of methods. A method prices a parcel by
 * weight, by order value, or at a flat rate, with optional free-shipping
 * thresholds.
 */

export type RateKind = "flat" | "weight" | "price" | "carrier";

export interface WeightBand {
  /** Grams, inclusive. */
  minGrams: number;
  /** Grams, exclusive. */
  maxGrams: number;
  price: Money;
}

export interface PriceBand {
  minTotal: Money;
  maxTotal: Money | null;
  price: Money;
}

export interface ShippingMethod {
  id: string;
  zoneId: string;
  name: string;
  description: string;
  kind: RateKind;
  flatPrice: Money | null;
  weightBands: WeightBand[];
  priceBands: PriceBand[];
  /** Orders above this ship free. */
  freeOver: Money | null;
  /** Business days, for the delivery estimate. */
  minDays: number;
  maxDays: number;
  /** Carrier code for a live rate lookup. */
  carrier: string | null;
  /** Only offered when every item allows it. */
  requiresShipping: boolean;
  active: boolean;
  position: number;
}

export interface ShippingZone {
  id: string;
  name: string;
  /** ISO country codes, or ["*"] for the rest of the world. */
  countries: string[];
  /** Region codes within the countries; empty means all. */
  regions: string[];
  /** Postal code prefixes this zone covers; empty means all. */
  postalPrefixes: string[];
  priority: number;
}

export interface Destination {
  countryCode: string;
  regionCode: string;
  postalCode: string;
}

export interface Parcel {
  weightGrams: number;
  itemCount: number;
  value: Money;
  /** Any item that cannot be posted, e.g. a download. */
  hasDigitalOnly: boolean;
}

export interface RateQuote {
  methodId: string;
  name: string;
  description: string;
  price: Money;
  estimatedDays: { min: number; max: number };
  free: boolean;
}

/** The most specific zone covering a destination. */
export function findZone(zones: ShippingZone[], destination: Destination): ShippingZone | null {
  const matches = zones.filter((zone) => {
    const countryOk = zone.countries.includes("*") || zone.countries.includes(destination.countryCode);
    if (!countryOk) return false;

    if (zone.regions.length > 0 && !zone.regions.includes(destination.regionCode)) return false;

    if (zone.postalPrefixes.length > 0) {
      const normalised = destination.postalCode.replace(/\s/g, "").toUpperCase();
      if (!zone.postalPrefixes.some((prefix) => normalised.startsWith(prefix))) return false;
    }

    return true;
  });

  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.priority - a.priority)[0];
}

/** Total shippable weight of a basket. */
export function parcelWeight(items: { variant: Variant; quantity: number }[]): number {
  return items
    .filter((item) => item.variant.requiresShipping)
    .reduce((total, item) => total + shippingWeight(item.variant) * item.quantity, 0);
}

function weightPrice(method: ShippingMethod, grams: number): Money | null {
  const band = method.weightBands.find((b) => grams >= b.minGrams && grams < b.maxGrams);
  return band ? band.price : null;
}

function pricePrice(method: ShippingMethod, value: Money): Money | null {
  const band = method.priceBands.find(
    (b) => !lessThan(value, b.minTotal) && (b.maxTotal === null || lessThan(value, b.maxTotal)),
  );
  return band ? band.price : null;
}

/** Price one method for a parcel, or null when it does not apply. */
export function priceMethod(method: ShippingMethod, parcel: Parcel): Money | null {
  if (!method.active) return null;
  if (method.requiresShipping && parcel.hasDigitalOnly) return null;

  if (method.freeOver && greaterThan(parcel.value, method.freeOver)) {
    return zero(parcel.value.currency);
  }

  switch (method.kind) {
    case "flat":
      return method.flatPrice;
    case "weight":
      return weightPrice(method, parcel.weightGrams);
    case "price":
      return pricePrice(method, parcel.value);
    case "carrier":
      return null;
    default:
      return null;
  }
}

/** Everything the shopper can choose from, cheapest first. */
export function quote(
  zones: ShippingZone[],
  methods: ShippingMethod[],
  destination: Destination,
  parcel: Parcel,
): RateQuote[] {
  const zone = findZone(zones, destination);
  if (!zone) return [];

  const quotes: RateQuote[] = [];

  for (const method of methods.filter((m) => m.zoneId === zone.id)) {
    const price = priceMethod(method, parcel);
    if (price === null) continue;

    quotes.push({
      methodId: method.id,
      name: method.name,
      description: method.description,
      price,
      estimatedDays: { min: method.minDays, max: method.maxDays },
      free: price.amount === 0,
    });
  }

  return quotes.sort((a, b) => a.price.amount - b.price.amount);
}

/** How much more the shopper must spend to reach free shipping. */
export function amountToFreeShipping(methods: ShippingMethod[], parcel: Parcel): Money | null {
  const thresholds = methods.map((m) => m.freeOver).filter((t): t is Money => t !== null);
  if (thresholds.length === 0) return null;

  const cheapest = thresholds.reduce((lowest, t) => (lessThan(t, lowest) ? t : lowest));
  if (greaterThan(parcel.value, cheapest)) return null;

  return money(cheapest.amount - parcel.value.amount, parcel.value.currency);
}

/** Working-day delivery window from today. */
export function deliveryWindow(method: ShippingMethod, from: Date): { earliest: string; latest: string } {
  const addBusinessDays = (start: Date, days: number): Date => {
    const date = new Date(start);
    let added = 0;
    while (added < days) {
      date.setDate(date.getDate() + 1);
      const day = date.getDay();
      if (day !== 0 && day !== 6) added++;
    }
    return date;
  };

  return {
    earliest: addBusinessDays(from, method.minDays).toISOString().slice(0, 10),
    latest: addBusinessDays(from, method.maxDays).toISOString().slice(0, 10),
  };
}

/** Split a basket into parcels that respect a carrier's weight ceiling. */
export function splitIntoParcels(
  items: { variant: Variant; quantity: number }[],
  maxGrams: number,
): Parcel[] {
  const parcels: Parcel[] = [];
  let current: Parcel = { weightGrams: 0, itemCount: 0, value: zero("EUR"), hasDigitalOnly: false };

  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      const unitWeight = shippingWeight(item.variant);

      if (current.weightGrams + unitWeight > maxGrams && current.itemCount > 0) {
        parcels.push(current);
        current = { weightGrams: 0, itemCount: 0, value: zero("EUR"), hasDigitalOnly: false };
      }

      current = {
        weightGrams: current.weightGrams + unitWeight,
        itemCount: current.itemCount + 1,
        value: add(current.value, item.variant.price),
        hasDigitalOnly: false,
      };
    }
  }

  if (current.itemCount > 0) parcels.push(current);
  return parcels;
}

export const DEFAULT_ZONES: ShippingZone[] = [
  { id: "nl", name: "Netherlands", countries: ["NL"], regions: [], postalPrefixes: [], priority: 10 },
  { id: "be-de", name: "Belgium & Germany", countries: ["BE", "DE"], regions: [], postalPrefixes: [], priority: 8 },
  { id: "eu", name: "Rest of EU", countries: ["FR", "ES", "IT", "PL", "SE", "DK", "AT", "PT", "IE", "FI"], regions: [], postalPrefixes: [], priority: 5 },
  { id: "world", name: "Rest of world", countries: ["*"], regions: [], postalPrefixes: [], priority: 1 },
];
