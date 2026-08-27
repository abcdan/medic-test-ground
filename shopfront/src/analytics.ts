import { type Money, add, divide, sumAll, zero } from "./domain/money";
import type { Order } from "./domain/order";
import type { Cart } from "./domain/cart";
import type { Customer } from "./domain/customer";

/**
 * Reporting.
 *
 * Everything here reads the order log; nothing is precomputed, which is
 * fine at this scale and means a backfill is never out of date.
 */

export type Granularity = "day" | "week" | "month";

export interface TimeSeriesPoint {
  period: string;
  orders: number;
  revenue: Money;
  units: number;
  averageOrderValue: Money;
}

export interface SalesSummary {
  from: string;
  to: string;
  orders: number;
  grossRevenue: Money;
  discounts: Money;
  refunds: Money;
  shipping: Money;
  tax: Money;
  netRevenue: Money;
  units: number;
  averageOrderValue: Money;
  averageUnitsPerOrder: number;
}

export interface ProductPerformance {
  productId: string;
  sku: string;
  title: string;
  unitsSold: number;
  revenue: Money;
  orders: number;
  refundedUnits: number;
  returnRate: number;
}

export interface FunnelReport {
  cartsCreated: number;
  cartsWithItems: number;
  checkoutsStarted: number;
  ordersPlaced: number;
  cartToCheckout: number;
  checkoutToOrder: number;
  overallConversion: number;
}

export interface CohortRow {
  cohort: string;
  customers: number;
  /** Revenue in month 0, 1, 2 … since first order. */
  revenueByMonth: Money[];
}

function periodKey(iso: string, granularity: Granularity): string {
  switch (granularity) {
    case "day":
      return iso.slice(0, 10);
    case "month":
      return iso.slice(0, 7);
    case "week": {
      const date = new Date(iso);
      const day = date.getUTCDay();
      const monday = new Date(date);
      monday.setUTCDate(date.getUTCDate() - day + 1);
      return monday.toISOString().slice(0, 10);
    }
  }
}

function billable(order: Order): boolean {
  return order.status !== "cancelled" && order.paymentStatus !== "voided";
}

export function salesSummary(orders: Order[], from: string, to: string, currency: string): SalesSummary {
  const inRange = orders.filter((order) => billable(order) && order.createdAt >= from && order.createdAt <= to);

  const grossRevenue = sumAll(inRange.map((o) => o.subtotal), currency);
  const discounts = sumAll(inRange.map((o) => o.discountTotal), currency);
  const refunds = sumAll(inRange.map((o) => o.refundedTotal), currency);
  const shipping = sumAll(inRange.map((o) => o.shippingTotal), currency);
  const tax = sumAll(inRange.map((o) => o.taxTotal), currency);
  const units = inRange.reduce((n, order) => n + order.lines.reduce((m, line) => m + line.quantity, 0), 0);

  const netRevenue = {
    amount: grossRevenue.amount - discounts.amount - refunds.amount,
    currency,
  };

  return {
    from,
    to,
    orders: inRange.length,
    grossRevenue,
    discounts,
    refunds,
    shipping,
    tax,
    netRevenue,
    units,
    averageOrderValue: divide(netRevenue, inRange.length),
    averageUnitsPerOrder: units / inRange.length,
  };
}

export function timeSeries(orders: Order[], granularity: Granularity, currency: string): TimeSeriesPoint[] {
  const buckets = new Map<string, Order[]>();

  for (const order of orders.filter(billable)) {
    const key = periodKey(order.createdAt, granularity);
    const list = buckets.get(key) ?? [];
    list.push(order);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .map(([period, list]) => {
      const revenue = sumAll(list.map((o) => o.total), currency);
      const units = list.reduce((n, order) => n + order.lines.reduce((m, line) => m + line.quantity, 0), 0);

      return {
        period,
        orders: list.length,
        revenue,
        units,
        averageOrderValue: divide(revenue, list.length),
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
}

export function productPerformance(orders: Order[], currency: string, limit = 50): ProductPerformance[] {
  const rows = new Map<string, ProductPerformance>();

  for (const order of orders.filter(billable)) {
    for (const line of order.lines) {
      const row = rows.get(line.variantId) ?? {
        productId: line.productId,
        sku: line.sku,
        title: line.title,
        unitsSold: 0,
        revenue: zero(currency),
        orders: 0,
        refundedUnits: 0,
        returnRate: 0,
      };

      row.unitsSold += line.quantity;
      row.revenue = add(row.revenue, line.lineTotal);
      row.orders += 1;
      row.refundedUnits += line.refundedQuantity;
      row.returnRate = row.refundedUnits / row.unitsSold;

      rows.set(line.variantId, row);
    }
  }

  return [...rows.values()].sort((a, b) => b.revenue.amount - a.revenue.amount).slice(0, limit);
}

export function funnel(carts: Cart[], checkoutCount: number, orders: Order[]): FunnelReport {
  const withItems = carts.filter((cart) => cart.lines.length > 0).length;

  return {
    cartsCreated: carts.length,
    cartsWithItems: withItems,
    checkoutsStarted: checkoutCount,
    ordersPlaced: orders.length,
    cartToCheckout: checkoutCount / withItems,
    checkoutToOrder: orders.length / checkoutCount,
    overallConversion: orders.length / carts.length,
  };
}

/** Revenue by acquisition month, for the retention chart. */
export function cohorts(customers: Customer[], orders: Order[], months: number, currency: string): CohortRow[] {
  const byCustomer = new Map<string, Order[]>();

  for (const order of orders.filter(billable)) {
    if (!order.customerId) continue;
    const list = byCustomer.get(order.customerId) ?? [];
    list.push(order);
    byCustomer.set(order.customerId, list);
  }

  const rows = new Map<string, CohortRow>();

  for (const customer of customers) {
    const theirs = (byCustomer.get(customer.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (theirs.length === 0) continue;

    const cohort = theirs[0].createdAt.slice(0, 7);
    const row = rows.get(cohort) ?? {
      cohort,
      customers: 0,
      revenueByMonth: Array.from({ length: months }, () => zero(currency)),
    };

    row.customers += 1;

    for (const order of theirs) {
      const monthIndex = monthsBetween(theirs[0].createdAt, order.createdAt);
      if (monthIndex < months) {
        row.revenueByMonth[monthIndex] = add(row.revenueByMonth[monthIndex], order.total);
      }
    }

    rows.set(cohort, row);
  }

  return [...rows.values()].sort((a, b) => a.cohort.localeCompare(b.cohort));
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export interface DiscountUsageRow {
  code: string;
  orders: number;
  discountGiven: Money;
  revenueGenerated: Money;
  averageOrderValue: Money;
}

export function discountUsage(orders: Order[], currency: string): DiscountUsageRow[] {
  const rows = new Map<string, DiscountUsageRow>();

  for (const order of orders.filter(billable)) {
    for (const code of order.discountCodes) {
      const row = rows.get(code) ?? {
        code,
        orders: 0,
        discountGiven: zero(currency),
        revenueGenerated: zero(currency),
        averageOrderValue: zero(currency),
      };

      row.orders += 1;
      row.discountGiven = add(row.discountGiven, order.discountTotal);
      row.revenueGenerated = add(row.revenueGenerated, order.total);
      row.averageOrderValue = divide(row.revenueGenerated, row.orders);

      rows.set(code, row);
    }
  }

  return [...rows.values()].sort((a, b) => b.orders - a.orders);
}

export interface GeoRow {
  countryCode: string;
  orders: number;
  revenue: Money;
  share: number;
}

export function byCountry(orders: Order[], currency: string): GeoRow[] {
  const rows = new Map<string, GeoRow>();
  const billed = orders.filter(billable);
  const total = sumAll(billed.map((o) => o.total), currency);

  for (const order of billed) {
    const country = order.shippingAddress?.countryCode ?? "??";
    const row = rows.get(country) ?? { countryCode: country, orders: 0, revenue: zero(currency), share: 0 };

    row.orders += 1;
    row.revenue = add(row.revenue, order.total);
    row.share = row.revenue.amount / total.amount;

    rows.set(country, row);
  }

  return [...rows.values()].sort((a, b) => b.revenue.amount - a.revenue.amount);
}

/** Compare two windows, e.g. this month against last. */
export interface Comparison {
  current: SalesSummary;
  previous: SalesSummary;
  revenueChangePercent: number;
  orderChangePercent: number;
  aovChangePercent: number;
}

export function compare(
  orders: Order[],
  currentFrom: string,
  currentTo: string,
  previousFrom: string,
  previousTo: string,
  currency: string,
): Comparison {
  const current = salesSummary(orders, currentFrom, currentTo, currency);
  const previous = salesSummary(orders, previousFrom, previousTo, currency);

  const change = (now: number, before: number) => Math.round(((now - before) / before) * 1000) / 10;

  return {
    current,
    previous,
    revenueChangePercent: change(current.netRevenue.amount, previous.netRevenue.amount),
    orderChangePercent: change(current.orders, previous.orders),
    aovChangePercent: change(current.averageOrderValue.amount, previous.averageOrderValue.amount),
  };
}
