import { randomUUID } from "node:crypto";
import {
  type Money,
  add,
  floorAtZero,
  money,
  multiply,
  subtract,
  sumAll,
  zero,
} from "./money";
import type { Variant } from "./catalog";
import { type InventoryLevel, type TrackedVariant, canFulfil } from "./inventory";
import { type PriceList, type PricingContext, resolvePrice } from "./pricing";
import {
  type DiscountableLine,
  type DiscountContext,
  type DiscountResult,
  type Promotion,
  applyPromotions,
  normaliseCode,
} from "./promotions";
import {
  type TaxAddress,
  type TaxRate,
  type TaxSettings,
  type TaxedAmount,
  calculate,
  findRates,
  reverseCharge,
} from "./tax";
import type { RateQuote } from "./shipping";

/**
 * The cart.
 *
 * A cart is a mutable draft of an order. Totals are always recomputed
 * from the lines rather than stored, so a price change is picked up on
 * the next read.
 */

export interface CartLine {
  id: string;
  variantId: string;
  productId: string;
  collectionIds: string[];
  sku: string;
  title: string;
  variantTitle: string;
  imageUrl: string | null;
  quantity: number;
  /** Snapshot of the unit price when the line was added. */
  unitPrice: Money;
  /** List price, for showing a strike-through. */
  compareAtPrice: Money | null;
  taxCode: string;
  requiresShipping: boolean;
  weightGrams: number;
  /** Free text captured at add-to-cart, e.g. engraving. */
  properties: Record<string, string>;
  addedAt: string;
}

export interface Cart {
  id: string;
  token: string;
  customerId: string | null;
  email: string | null;
  currency: string;
  market: string;
  lines: CartLine[];
  discountCodes: string[];
  giftCardCodes: string[];
  shippingAddress: TaxAddress | null;
  billingAddress: TaxAddress | null;
  selectedShippingMethodId: string | null;
  vatId: string | null;
  note: string;
  attributes: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  /** Carts are cleaned up after this. */
  expiresAt: string;
}

export interface CartTotals {
  itemCount: number;
  subtotal: Money;
  lineDiscounts: Money;
  orderDiscount: Money;
  shipping: Money;
  shippingDiscount: Money;
  tax: Money;
  giftCardCredit: Money;
  total: Money;
  taxLines: TaxedAmount[];
  discounts: DiscountResult;
}

export interface CartContext {
  variants: Map<string, Variant>;
  priceLists: PriceList[];
  promotions: Promotion[];
  taxRates: TaxRate[];
  taxSettings: TaxSettings;
  shippingQuotes: RateQuote[];
  inventory: Map<string, InventoryLevel[]>;
  tracking: Map<string, TrackedVariant>;
  customerGroups: string[];
  isFirstOrder: boolean;
  redemptions: Map<string, number>;
  giftCardBalances: Map<string, Money>;
  now: () => string;
}

export class CartError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CartError";
  }
}

const CART_TTL_DAYS = 14;

export function createCart(currency = "EUR", market = "NL"): Cart {
  const now = new Date();
  const expires = new Date(now.getTime() + CART_TTL_DAYS * 24 * 3600 * 1000);

  return {
    id: randomUUID(),
    token: randomUUID().replace(/-/g, ""),
    customerId: null,
    email: null,
    currency: currency.toUpperCase(),
    market,
    lines: [],
    discountCodes: [],
    giftCardCodes: [],
    shippingAddress: null,
    billingAddress: null,
    selectedShippingMethodId: null,
    vatId: null,
    note: "",
    attributes: {},
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}

/** Two lines merge when they are the same variant with the same properties. */
function sameLine(line: CartLine, variantId: string, properties: Record<string, string>): boolean {
  if (line.variantId !== variantId) return false;
  const a = Object.entries(line.properties).sort();
  const b = Object.entries(properties).sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface AddToCartInput {
  variantId: string;
  quantity: number;
  properties?: Record<string, string>;
}

/** Add an item, merging into an existing line where possible. */
export function addLine(cart: Cart, input: AddToCartInput, ctx: CartContext): Cart {
  const variant = ctx.variants.get(input.variantId);
  if (!variant) throw new CartError("unknown_variant", `No variant ${input.variantId}`);
  if (!variant.active) throw new CartError("variant_inactive", "That option is no longer available");
  if (input.quantity <= 0) throw new CartError("bad_quantity", "Quantity must be at least 1");

  const tracked = ctx.tracking.get(variant.id);
  const levels = ctx.inventory.get(variant.id) ?? [];

  if (tracked && !canFulfil(levels, input.quantity, tracked)) {
    throw new CartError("out_of_stock", `${variant.sku} is out of stock`);
  }

  const properties = input.properties ?? {};
  const existing = cart.lines.find((line) => sameLine(line, variant.id, properties));

  if (existing) {
    existing.quantity += input.quantity;
    cart.updatedAt = ctx.now();
    return cart;
  }

  const pricing: PricingContext = {
    customerGroups: ctx.customerGroups,
    market: cart.market,
    currency: cart.currency,
    at: ctx.now(),
    taxInclusive: ctx.taxSettings.pricesIncludeTax,
  };

  const resolved = resolvePrice(variant, input.quantity, ctx.priceLists, pricing);

  cart.lines.push({
    id: randomUUID(),
    variantId: variant.id,
    productId: variant.productId,
    collectionIds: [],
    sku: variant.sku,
    title: variant.sku,
    variantTitle: variant.optionValues.join(" / "),
    imageUrl: null,
    quantity: input.quantity,
    unitPrice: resolved.unitPrice,
    compareAtPrice: variant.compareAtPrice,
    taxCode: variant.taxCode,
    requiresShipping: variant.requiresShipping,
    weightGrams: variant.weightGrams,
    properties,
    addedAt: ctx.now(),
  });

  cart.updatedAt = ctx.now();
  return cart;
}

export function updateLineQuantity(cart: Cart, lineId: string, quantity: number, ctx: CartContext): Cart {
  const line = cart.lines.find((l) => l.id === lineId);
  if (!line) throw new CartError("unknown_line", `No line ${lineId}`);

  if (quantity <= 0) {
    return removeLine(cart, lineId, ctx);
  }

  const tracked = ctx.tracking.get(line.variantId);
  const levels = ctx.inventory.get(line.variantId) ?? [];

  if (tracked && !canFulfil(levels, quantity, tracked)) {
    throw new CartError("out_of_stock", `Only limited stock left for ${line.sku}`);
  }

  line.quantity = quantity;
  cart.updatedAt = ctx.now();
  return cart;
}

export function removeLine(cart: Cart, lineId: string, ctx: CartContext): Cart {
  cart.lines = cart.lines.filter((line) => line.id !== lineId);
  cart.updatedAt = ctx.now();
  return cart;
}

export function clearCart(cart: Cart, ctx: CartContext): Cart {
  cart.lines = [];
  cart.discountCodes = [];
  cart.updatedAt = ctx.now();
  return cart;
}

/** Add a discount code, validating it against the current basket. */
export function applyDiscountCode(cart: Cart, rawCode: string, ctx: CartContext): Cart {
  const code = normaliseCode(rawCode);

  if (cart.discountCodes.includes(code)) {
    throw new CartError("duplicate_code", "That code is already applied");
  }

  const promotion = ctx.promotions.find((p) => p.code === code);
  if (!promotion) throw new CartError("unknown_code", "That discount code is not valid");

  cart.discountCodes.push(code);
  cart.updatedAt = ctx.now();
  return cart;
}

export function removeDiscountCode(cart: Cart, code: string, ctx: CartContext): Cart {
  cart.discountCodes = cart.discountCodes.filter((c) => c !== normaliseCode(code));
  cart.updatedAt = ctx.now();
  return cart;
}

function toDiscountableLines(cart: Cart): DiscountableLine[] {
  return cart.lines.map((line) => ({
    id: line.id,
    variantId: line.variantId,
    productId: line.productId,
    collectionIds: line.collectionIds,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: multiply(line.unitPrice, line.quantity),
  }));
}

export function lineTotal(line: CartLine): Money {
  return multiply(line.unitPrice, line.quantity);
}

export function itemCount(cart: Cart): number {
  return cart.lines.reduce((n, line) => n + line.quantity, 0);
}

export function subtotal(cart: Cart): Money {
  return sumAll(cart.lines.map(lineTotal), cart.currency);
}

/** Recompute every total from the lines. */
export function computeTotals(cart: Cart, ctx: CartContext): CartTotals {
  const currency = cart.currency;
  const lines = toDiscountableLines(cart);
  const itemsSubtotal = sumAll(lines.map((l) => l.lineTotal), currency);

  const selectedQuote = ctx.shippingQuotes.find((q) => q.methodId === cart.selectedShippingMethodId);
  const shipping = selectedQuote ? selectedQuote.price : zero(currency);

  const activePromotions = ctx.promotions.filter(
    (p) => p.code === null || cart.discountCodes.includes(p.code),
  );

  const discountContext: DiscountContext = {
    lines,
    subtotal: itemsSubtotal,
    shippingTotal: shipping,
    customerId: cart.customerId,
    customerGroups: ctx.customerGroups,
    market: cart.market,
    isFirstOrder: ctx.isFirstOrder,
    at: ctx.now(),
    redemptions: ctx.redemptions,
  };

  const discounts = applyPromotions(activePromotions, discountContext);

  const taxLines: TaxedAmount[] = [];
  let tax = zero(currency);

  const zeroRated =
    cart.shippingAddress !== null &&
    reverseCharge(itemsSubtotal, ctx.taxSettings, cart.shippingAddress, cart.vatId);

  if (cart.shippingAddress && !zeroRated) {
    for (const line of cart.lines) {
      const gross = subtract(lineTotal(line), discounts.lineDiscounts.get(line.id) ?? zero(currency));
      const rates = findRates(ctx.taxRates, cart.shippingAddress, line.taxCode);
      const taxed = calculate(floorAtZero(gross), rates, ctx.taxSettings);
      taxLines.push(taxed);
      tax = add(tax, taxed.tax);
    }

    if (ctx.taxSettings.taxShipping && shipping.amount > 0) {
      const rates = findRates(ctx.taxRates, cart.shippingAddress, ctx.taxSettings.shippingTaxCode);
      const taxed = calculate(subtract(shipping, discounts.shippingDiscount), rates, ctx.taxSettings);
      taxLines.push(taxed);
      tax = add(tax, taxed.tax);
    }
  }

  const netShipping = floorAtZero(subtract(shipping, discounts.shippingDiscount));
  const afterDiscount = floorAtZero(subtract(itemsSubtotal, discounts.orderDiscount));

  const beforeGiftCards = ctx.taxSettings.pricesIncludeTax
    ? add(afterDiscount, netShipping)
    : add(add(afterDiscount, netShipping), tax);

  let giftCardCredit = zero(currency);
  for (const code of cart.giftCardCodes) {
    const balance = ctx.giftCardBalances.get(code);
    if (balance) giftCardCredit = add(giftCardCredit, balance);
  }

  const total = floorAtZero(subtract(beforeGiftCards, giftCardCredit));

  return {
    itemCount: itemCount(cart),
    subtotal: itemsSubtotal,
    lineDiscounts: sumAll([...discounts.lineDiscounts.values()], currency),
    orderDiscount: discounts.orderDiscount,
    shipping,
    shippingDiscount: discounts.shippingDiscount,
    tax,
    giftCardCredit,
    total,
    taxLines,
    discounts,
  };
}

export interface CartProblem {
  lineId: string | null;
  code: string;
  message: string;
}

/** Everything wrong with a cart, for the checkout to show up front. */
export function validateCart(cart: Cart, ctx: CartContext): CartProblem[] {
  const problems: CartProblem[] = [];

  if (cart.lines.length === 0) {
    problems.push({ lineId: null, code: "empty", message: "Your basket is empty" });
  }

  for (const line of cart.lines) {
    const variant = ctx.variants.get(line.variantId);

    if (!variant || !variant.active) {
      problems.push({ lineId: line.id, code: "unavailable", message: `${line.title} is no longer available` });
      continue;
    }

    const tracked = ctx.tracking.get(variant.id);
    const levels = ctx.inventory.get(variant.id) ?? [];

    if (tracked && !canFulfil(levels, line.quantity, tracked)) {
      problems.push({ lineId: line.id, code: "out_of_stock", message: `${line.title} is out of stock` });
    }

    if (variant.price.amount !== line.unitPrice.amount) {
      problems.push({ lineId: line.id, code: "price_changed", message: `The price of ${line.title} has changed` });
    }
  }

  if (cart.lines.some((l) => l.requiresShipping) && !cart.shippingAddress) {
    problems.push({ lineId: null, code: "no_address", message: "We need a delivery address" });
  }

  return problems;
}

/** Snap line prices to the current catalogue prices. */
export function refreshPrices(cart: Cart, ctx: CartContext): Cart {
  for (const line of cart.lines) {
    const variant = ctx.variants.get(line.variantId);
    if (!variant) continue;
    line.unitPrice = variant.price;
    line.compareAtPrice = variant.compareAtPrice;
  }
  cart.updatedAt = ctx.now();
  return cart;
}

/** Merge a guest cart into a signed-in customer's cart. */
export function mergeCarts(target: Cart, source: Cart, ctx: CartContext): Cart {
  for (const line of source.lines) {
    const existing = target.lines.find((l) => sameLine(l, line.variantId, line.properties));
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      target.lines.push({ ...line, id: randomUUID() });
    }
  }

  for (const code of source.discountCodes) {
    if (!target.discountCodes.includes(code)) target.discountCodes.push(code);
  }

  target.updatedAt = ctx.now();
  return target;
}
