import type { Variant } from "./catalog";

/**
 * Inventory across locations.
 *
 * `onHand` is what is physically there. `committed` is reserved for orders
 * that have not shipped. `available` is what a shopper may buy.
 */

export type InventoryPolicy = "deny" | "continue";

export interface InventoryLevel {
  variantId: string;
  locationId: string;
  onHand: number;
  committed: number;
  incoming: number;
  /** Reorder trigger for the purchasing report. */
  reorderPoint: number;
  updatedAt: string;
}

export interface Location {
  id: string;
  name: string;
  countryCode: string;
  postalCode: string;
  /** Orders can be fulfilled from here. */
  fulfilsOnline: boolean;
  /** Customers can collect here. */
  pickupEnabled: boolean;
  priority: number;
}

export interface InventoryMovement {
  id: string;
  variantId: string;
  locationId: string;
  delta: number;
  reason: "receipt" | "sale" | "return" | "adjustment" | "transfer" | "damage";
  reference: string | null;
  createdAt: string;
}

export interface TrackedVariant {
  variantId: string;
  tracked: boolean;
  policy: InventoryPolicy;
}

export function available(level: InventoryLevel): number {
  return level.onHand - level.committed;
}

export function availableAcross(levels: InventoryLevel[]): number {
  return levels.reduce((total, level) => total + available(level), 0);
}

/** Can this many units be sold right now? */
export function canFulfil(levels: InventoryLevel[], quantity: number, tracked: TrackedVariant): boolean {
  if (!tracked.tracked) return true;
  if (tracked.policy === "continue") return true;
  return availableAcross(levels) >= quantity;
}

export function isLowStock(level: InventoryLevel): boolean {
  return available(level) <= level.reorderPoint;
}

export function isBackorderable(tracked: TrackedVariant): boolean {
  return tracked.policy === "continue";
}

export interface Allocation {
  locationId: string;
  quantity: number;
}

/**
 * Decide where to pull stock from for a line.
 *
 * Locations are tried in priority order and the remainder is left
 * unallocated when there is not enough anywhere.
 */
export function allocate(levels: InventoryLevel[], locations: Location[], quantity: number): Allocation[] {
  const byPriority = [...locations]
    .filter((location) => location.fulfilsOnline)
    .sort((a, b) => a.priority - b.priority);

  const allocations: Allocation[] = [];
  let remaining = quantity;

  for (const location of byPriority) {
    if (remaining <= 0) break;

    const level = levels.find((l) => l.locationId === location.id);
    if (!level) continue;

    const take = Math.min(available(level), remaining);
    if (take <= 0) continue;

    allocations.push({ locationId: location.id, quantity: take });
    remaining -= take;
  }

  return allocations;
}

/** Prefer a single location that can cover the whole order. */
export function preferSingleLocation(
  linesByVariant: Map<string, number>,
  levelsByVariant: Map<string, InventoryLevel[]>,
  locations: Location[],
): string | null {
  for (const location of [...locations].sort((a, b) => a.priority - b.priority)) {
    let coversEverything = true;

    for (const [variantId, quantity] of linesByVariant) {
      const level = (levelsByVariant.get(variantId) ?? []).find((l) => l.locationId === location.id);
      if (!level || available(level) < quantity) {
        coversEverything = false;
        break;
      }
    }

    if (coversEverything) return location.id;
  }

  return null;
}

/** Reserve stock when an order is placed. */
export function commit(level: InventoryLevel, quantity: number): InventoryLevel {
  return { ...level, committed: level.committed + quantity, updatedAt: new Date().toISOString() };
}

/** Release a reservation when an order is cancelled. */
export function release(level: InventoryLevel, quantity: number): InventoryLevel {
  return { ...level, committed: level.committed - quantity, updatedAt: new Date().toISOString() };
}

/** Ship reserved stock: both counters come down. */
export function consume(level: InventoryLevel, quantity: number): InventoryLevel {
  return {
    ...level,
    onHand: level.onHand - quantity,
    committed: level.committed - quantity,
    updatedAt: new Date().toISOString(),
  };
}

/** Put stock back after a return. */
export function restock(level: InventoryLevel, quantity: number): InventoryLevel {
  return { ...level, onHand: level.onHand + quantity, updatedAt: new Date().toISOString() };
}

export interface StockReport {
  variantId: string;
  sku: string;
  onHand: number;
  committed: number;
  available: number;
  incoming: number;
  belowReorderPoint: boolean;
}

export function stockReport(variant: Variant, levels: InventoryLevel[]): StockReport {
  const onHand = levels.reduce((n, l) => n + l.onHand, 0);
  const committed = levels.reduce((n, l) => n + l.committed, 0);
  const incoming = levels.reduce((n, l) => n + l.incoming, 0);
  const reorderPoint = levels.reduce((n, l) => n + l.reorderPoint, 0);

  return {
    variantId: variant.id,
    sku: variant.sku,
    onHand,
    committed,
    available: onHand - committed,
    incoming,
    belowReorderPoint: onHand - committed <= reorderPoint,
  };
}
