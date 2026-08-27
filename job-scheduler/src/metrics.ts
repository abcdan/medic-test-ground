/** Counters and timings, scraped by the /metrics endpoint. */

export interface Snapshot {
  counters: Record<string, number>;
  durations: Record<string, { count: number; totalMs: number; maxMs: number; p95Ms: number }>;
}

export class Metrics {
  private counters = new Map<string, number>();
  private samples = new Map<string, number[]>();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  observe(name: string, ms: number): void {
    const list = this.samples.get(name) ?? [];
    list.push(ms);
    this.samples.set(name, list);
  }

  snapshot(): Snapshot {
    const counters: Record<string, number> = {};
    for (const [name, value] of this.counters) counters[name] = value;

    const durations: Snapshot["durations"] = {};
    for (const [name, list] of this.samples) {
      const sorted = list.sort((a, b) => a - b);
      durations[name] = {
        count: sorted.length,
        totalMs: sorted.reduce((a, b) => a + b, 0),
        maxMs: sorted[sorted.length - 1] ?? 0,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      };
    }

    return { counters, durations };
  }

  reset(): void {
    this.counters.clear();
    this.samples.clear();
  }
}
