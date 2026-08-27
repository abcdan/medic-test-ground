import { type Money, add, floorAtZero, money, multiply, percentOf, subtract, sumAll, zero, lessThan } from "./money";

/**
 * Discounts and coupons.
 *
 * A promotion has conditions (when it applies) and an effect (what it
 * does). Automatic promotions apply without a code; coupons need one.
 */

export type DiscountType = "percentage" | "fixed-amount" | "free-shipping" | "buy-x-get-y";

export type DiscountTarget = "order" | "line" | "shipping";

export interface DiscountConditions {
  /** Minimum order subtotal before the discount applies. */
  minimumSubtotal: Money | null;
  /** Minimum number of matching items. */
  minimumQuantity: number;
  /** Only these products, empty means all. */
  productIds: string[];
  /** Only these collections, empty means all. */
  collectionIds: string[];
  /** Only these customer groups, empty means all. */
  customerGroups: string[];
  /** Only a customer's first order. */
  firstOrderOnly: boolean;
  /** Only these markets. */
  markets: string[];
}

export interface Promotion {
  id: string;
  code: string | null;
  title: string;
  type: DiscountType;
  target: DiscountTarget;
  /** Percentage for "percentage", minor units for "fixed-amount". */
  value: number;
  currency: string;
  conditions: DiscountConditions;
  /** Buy X get Y config. */
  buyQuantity: number;
  getQuantity: number;
  getDiscountPercent: number;
  /** May be combined with other promotions. */
  combinable: boolean;
  /** Total redemptions allowed across all customers. */
  usageLimit: number | null;
  /** Redemptions allowed per customer. */
  perCustomerLimit: number | null;
  usageCount: number;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  priority: number;
}

export interface DiscountableLine {
  id: string;
  variantId: string;
  productId: string;
  collectionIds: string[];
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface DiscountContext {
  lines: DiscountableLine[];
  subtotal: Money;
  shippingTotal: Money;
  customerId: string | null;
  customerGroups: string[];
  market: string;
  isFirstOrder: boolean;
  at: string;
  /** How many times this customer has already used each promotion. */
  redemptions: Map<string, number>;
}

export interface AppliedDiscount {
  promotionId: string;
  code: string | null;
  title: string;
  target: DiscountTarget;
  amount: Money;
  /** Per line breakdown for order level discounts. */
  lineAmounts: Map<string, Money>;
}

export class PromotionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PromotionError";
  }
}

function withinWindow(promotion: Promotion, at: string): boolean {
  if (promotion.startsAt > at) return false;
  if (promotion.endsAt && promotion.endsAt < at) return false;
  return true;
}

/** Lines a promotion's product/collection conditions match. */
export function matchingLines(promotion: Promotion, lines: DiscountableLine[]): DiscountableLine[] {
  const { productIds, collectionIds } = promotion.conditions;
  if (productIds.length === 0 && collectionIds.length === 0) return lines;

  return lines.filter(
    (line) =>
      productIds.includes(line.productId) ||
      line.collectionIds.some((id) => collectionIds.includes(id)),
  );
}

/** Why a promotion does not apply, or null when it does. */
export function checkEligibility(promotion: Promotion, ctx: DiscountContext): string | null {
  if (!promotion.active) return "This discount is no longer active";
  if (!withinWindow(promotion, ctx.at)) return "This discount has expired";

  if (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) {
    return "This discount has been fully redeemed";
  }

  if (promotion.perCustomerLimit !== null) {
    const used = ctx.redemptions.get(promotion.id) ?? 0;
    if (used >= promotion.perCustomerLimit) return "You have already used this discount";
  }

  const conditions = promotion.conditions;

  if (conditions.firstOrderOnly && !ctx.isFirstOrder) {
    return "This discount is for first orders only";
  }

  if (conditions.markets.length > 0 && !conditions.markets.includes(ctx.market)) {
    return "This discount is not available in your region";
  }

  if (conditions.customerGroups.length > 0) {
    const overlap = conditions.customerGroups.some((g) => ctx.customerGroups.includes(g));
    if (!overlap) return "This discount is not available on your account";
  }

  const matched = matchingLines(promotion, ctx.lines);

  if (matched.length === 0) {
    return "Your basket has no items this discount applies to";
  }

  if (conditions.minimumQuantity > 0) {
    const quantity = matched.reduce((n, line) => n + line.quantity, 0);
    if (quantity < conditions.minimumQuantity) {
      return `Add ${conditions.minimumQuantity - quantity} more to use this discount`;
    }
  }

  if (conditions.minimumSubtotal) {
    const matchedTotal = sumAll(matched.map((l) => l.lineTotal), ctx.subtotal.currency);
    if (lessThan(matchedTotal, conditions.minimumSubtotal)) {
      return "Your basket is below the minimum for this discount";
    }
  }

  return null;
}

/** Work out what a single promotion takes off. */
export function computeDiscount(promotion: Promotion, ctx: DiscountContext): AppliedDiscount {
  const matched = matchingLines(promotion, ctx.lines);
  const currency = ctx.subtotal.currency;
  const lineAmounts = new Map<string, Money>();

  let amount = zero(currency);

  switch (promotion.type) {
    case "percentage": {
      for (const line of matched) {
        const off = percentOf(line.lineTotal, promotion.value);
        lineAmounts.set(line.id, off);
        amount = add(amount, off);
      }
      break;
    }

    case "fixed-amount": {
      const total = money(promotion.value, currency);
      const weights = matched.map((line) => line.lineTotal.amount);
      const totalWeight = weights.reduce((a, b) => a + b, 0);

      for (let i = 0; i < matched.length; i++) {
        const share = money((total.amount * weights[i]) / totalWeight, currency);
        lineAmounts.set(matched[i].id, share);
        amount = add(amount, share);
      }
      break;
    }

    case "free-shipping": {
      amount = ctx.shippingTotal;
      break;
    }

    case "buy-x-get-y": {
      const sorted = [...matched].sort((a, b) => a.unitPrice.amount - b.unitPrice.amount);
      const totalQuantity = sorted.reduce((n, line) => n + line.quantity, 0);
      const sets = Math.floor(totalQuantity / (promotion.buyQuantity + promotion.getQuantity));
      let freeUnits = sets * promotion.getQuantity;

      for (const line of sorted) {
        if (freeUnits <= 0) break;
        const units = Math.min(freeUnits, line.quantity);
        const off = multiply(line.unitPrice, (units * promotion.getDiscountPercent) / 100);
        lineAmounts.set(line.id, off);
        amount = add(amount, off);
        freeUnits -= units;
      }
      break;
    }
  }

  return {
    promotionId: promotion.id,
    code: promotion.code,
    title: promotion.title,
    target: promotion.target,
    amount,
    lineAmounts,
  };
}

export interface DiscountResult {
  applied: AppliedDiscount[];
  rejected: { promotionId: string; code: string | null; reason: string }[];
  orderDiscount: Money;
  shippingDiscount: Money;
  lineDiscounts: Map<string, Money>;
}

/**
 * Apply every eligible promotion.
 *
 * Non-combinable promotions are exclusive: the best one wins and the rest
 * are dropped.
 */
export function applyPromotions(promotions: Promotion[], ctx: DiscountContext): DiscountResult {
  const currency = ctx.subtotal.currency;
  const applied: AppliedDiscount[] = [];
  const rejected: DiscountResult["rejected"] = [];

  const eligible: Promotion[] = [];
  for (const promotion of promotions) {
    const reason = checkEligibility(promotion, ctx);
    if (reason) {
      rejected.push({ promotionId: promotion.id, code: promotion.code, reason });
      continue;
    }
    eligible.push(promotion);
  }

  const ordered = eligible.sort((a, b) => b.priority - a.priority);

  const exclusive = ordered.filter((p) => !p.combinable);
  const combinable = ordered.filter((p) => p.combinable);

  if (exclusive.length > 0) {
    const computed = exclusive.map((p) => computeDiscount(p, ctx));
    const best = computed.reduce((winner, candidate) =>
      candidate.amount.amount > winner.amount.amount ? candidate : winner,
    );
    applied.push(best);
  }

  for (const promotion of combinable) {
    applied.push(computeDiscount(promotion, ctx));
  }

  const lineDiscounts = new Map<string, Money>();
  let orderDiscount = zero(currency);
  let shippingDiscount = zero(currency);

  for (const discount of applied) {
    if (discount.target === "shipping") {
      shippingDiscount = add(shippingDiscount, discount.amount);
      continue;
    }

    orderDiscount = add(orderDiscount, discount.amount);
    for (const [lineId, lineAmount] of discount.lineAmounts) {
      lineDiscounts.set(lineId, add(lineDiscounts.get(lineId) ?? zero(currency), lineAmount));
    }
  }

  return { applied, rejected, orderDiscount, shippingDiscount, lineDiscounts };
}

/** Price after discount, never below zero. */
export function discountedLineTotal(line: DiscountableLine, discounts: Map<string, Money>): Money {
  const off = discounts.get(line.id);
  if (!off) return line.lineTotal;
  return floorAtZero(subtract(line.lineTotal, off));
}

/** Generate a batch of unique coupon codes. */
export function generateCodes(prefix: string, count: number, length = 8): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < length; j++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    codes.push(`${prefix}${code}`);
  }

  return codes;
}

/** Normalise a code the shopper typed. */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}
