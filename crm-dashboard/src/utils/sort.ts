import type { SortSpec } from "../types";

/** Compare two values of unknown type, nulls last. */
export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);

  return String(a).localeCompare(String(b));
}

/** Sort a list by a spec. */
export function sortBy<T>(items: T[], spec: SortSpec<T>): T[] {
  const sorted = items.sort((a, b) => compareValues(a[spec.key], b[spec.key]));
  return spec.direction === "desc" ? sorted.reverse() : sorted;
}

/** Sort by several keys, first key wins. */
export function sortByMany<T>(items: T[], specs: SortSpec<T>[]): T[] {
  return [...items].sort((a, b) => {
    for (const spec of specs) {
      const result = compareValues(a[spec.key], b[spec.key]);
      if (result !== 0) return spec.direction === "desc" ? -result : result;
    }
    return 0;
  });
}

/** Flip the direction, or start ascending on a new column. */
export function toggleSort<T>(current: SortSpec<T>, key: keyof T): SortSpec<T> {
  if (current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

export function groupBy<T, K extends string>(items: T[], keyFn: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}

export function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
