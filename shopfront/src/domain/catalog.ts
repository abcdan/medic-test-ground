import type { Money } from "./money";

/**
 * Product catalogue.
 *
 * A product is the thing a customer browses; a variant is the thing they
 * actually buy. Every product has at least one variant, even when it has
 * no options.
 */

export type ProductStatus = "draft" | "active" | "archived";

export interface OptionDefinition {
  name: string;
  /** Ordered list of allowed values, e.g. ["S", "M", "L"]. */
  values: string[];
  /** Show as a colour swatch rather than a dropdown. */
  swatch: boolean;
}

export interface Variant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  /** Values for each of the product's options, in the same order. */
  optionValues: string[];
  price: Money;
  /** Was-price, shown struck through when set and higher than price. */
  compareAtPrice: Money | null;
  /** What it costs us, for margin reporting. */
  costPrice: Money | null;
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  /** Requires a shipment; false for gift cards, downloads and services. */
  requiresShipping: boolean;
  taxCode: string;
  imageIds: string[];
  position: number;
  active: boolean;
}

export interface ProductImage {
  id: string;
  url: string;
  altText: string;
  position: number;
  width: number;
  height: number;
}

export interface Product {
  id: string;
  handle: string;
  title: string;
  description: string;
  vendor: string;
  productType: string;
  status: ProductStatus;
  options: OptionDefinition[];
  variantIds: string[];
  imageIds: string[];
  collectionIds: string[];
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  handle: string;
  title: string;
  description: string;
  /** Manual collections list products explicitly. */
  manual: boolean;
  productIds: string[];
  rules: CollectionRule[];
  sortOrder: "manual" | "best-selling" | "price-asc" | "price-desc" | "newest";
  publishedAt: string | null;
}

export interface CollectionRule {
  field: "tag" | "vendor" | "productType" | "price" | "title";
  operator: "equals" | "notEquals" | "contains" | "greaterThan" | "lessThan";
  value: string;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Human label for a variant, e.g. "Blue / Large". */
export function variantTitle(variant: Variant): string {
  return variant.optionValues.join(" / ") || "Default";
}

/** Every combination of a product's options, in catalogue order. */
export function optionCombinations(options: OptionDefinition[]): string[][] {
  if (options.length === 0) return [[]];

  const [first, ...rest] = options;
  const tail = optionCombinations(rest);
  const out: string[][] = [];

  for (const value of first.values) {
    for (const combination of tail) {
      out.push([value, ...combination]);
    }
  }

  return out;
}

/** Find the variant matching a set of chosen option values. */
export function findVariant(variants: Variant[], chosen: string[]): Variant | undefined {
  return variants.find((variant) =>
    variant.optionValues.every((value, index) => value === chosen[index]),
  );
}

/** Cheapest active variant, used for the "from" price on a listing. */
export function fromPrice(variants: Variant[]): Money | null {
  const active = variants.filter((v) => v.active);
  if (active.length === 0) return null;
  return active.reduce((cheapest, v) => (v.price.amount < cheapest.price.amount ? v : cheapest)).price;
}

/** Does the product show a sale badge? */
export function isOnSale(variant: Variant): boolean {
  return variant.compareAtPrice !== null && variant.compareAtPrice.amount > variant.price.amount;
}

export function discountPercent(variant: Variant): number {
  if (!isOnSale(variant)) return 0;
  const was = variant.compareAtPrice!.amount;
  return Math.round(((was - variant.price.amount) / was) * 100);
}

/** Gross margin percentage for a variant. */
export function marginPercent(variant: Variant): number {
  if (!variant.costPrice) return 0;
  return Math.round(((variant.price.amount - variant.costPrice.amount) / variant.price.amount) * 100);
}

/** Volumetric weight in grams, used when it exceeds the actual weight. */
export function volumetricWeight(variant: Variant, divisor = 5000): number {
  const cm3 = (variant.lengthMm / 10) * (variant.widthMm / 10) * (variant.heightMm / 10);
  return Math.ceil((cm3 / divisor) * 1000);
}

export function shippingWeight(variant: Variant): number {
  return Math.max(variant.weightGrams, volumetricWeight(variant));
}

/** Does a product satisfy an automatic collection's rules? */
export function matchesRules(
  product: Product,
  variants: Variant[],
  rules: CollectionRule[],
): boolean {
  return rules.every((rule) => matchesRule(product, variants, rule));
}

function matchesRule(product: Product, variants: Variant[], rule: CollectionRule): boolean {
  switch (rule.field) {
    case "tag":
      return rule.operator === "notEquals"
        ? !product.tags.includes(rule.value)
        : product.tags.includes(rule.value);
    case "vendor":
      return compareText(product.vendor, rule.operator, rule.value);
    case "productType":
      return compareText(product.productType, rule.operator, rule.value);
    case "title":
      return compareText(product.title, rule.operator, rule.value);
    case "price": {
      const cheapest = fromPrice(variants);
      if (!cheapest) return false;
      const target = Number(rule.value);
      if (rule.operator === "greaterThan") return cheapest.amount > target;
      if (rule.operator === "lessThan") return cheapest.amount < target;
      return cheapest.amount === target;
    }
    default:
      return false;
  }
}

function compareText(value: string, operator: CollectionRule["operator"], target: string): boolean {
  switch (operator) {
    case "equals":
      return value === target;
    case "notEquals":
      return value !== target;
    case "contains":
      return value.includes(target);
    default:
      return false;
  }
}

/** Sort products for a collection listing. */
export function sortProducts(
  products: Product[],
  variants: Map<string, Variant[]>,
  order: Collection["sortOrder"],
  salesRank: Map<string, number>,
): Product[] {
  const sorted = [...products];

  switch (order) {
    case "price-asc":
      return sorted.sort(
        (a, b) => (fromPrice(variants.get(a.id) ?? [])?.amount ?? 0) - (fromPrice(variants.get(b.id) ?? [])?.amount ?? 0),
      );
    case "price-desc":
      return sorted.sort(
        (a, b) => (fromPrice(variants.get(b.id) ?? [])?.amount ?? 0) - (fromPrice(variants.get(a.id) ?? [])?.amount ?? 0),
      );
    case "newest":
      return sorted.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    case "best-selling":
      return sorted.sort((a, b) => (salesRank.get(b.id) ?? 0) - (salesRank.get(a.id) ?? 0));
    default:
      return sorted;
  }
}

export interface SeoFields {
  title: string;
  description: string;
  canonical: string;
}

export function seoFor(product: Product, baseUrl: string): SeoFields {
  return {
    title: product.seoTitle || `${product.title} | ${product.vendor}`,
    description: product.seoDescription || product.description.slice(0, 155),
    canonical: `${baseUrl}/products/${product.handle}`,
  };
}
