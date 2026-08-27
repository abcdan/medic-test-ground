/**
 * Accounting periods.
 *
 * Periods are calendar months. Once a period is closed, no more entries may
 * be posted into it; a correction has to go into an open period instead.
 */

export type PeriodStatus = "open" | "closed" | "locked";

export interface Period {
  /** YYYY-MM. */
  id: string;
  year: number;
  month: number;
  status: PeriodStatus;
  closedAt: string | null;
  closedBy: string | null;
}

export function periodIdFor(date: string): string {
  return date.slice(0, 7);
}

export function periodStart(id: string): string {
  return `${id}-01`;
}

export function periodEnd(id: string): string {
  const [year, month] = id.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return `${id}-${String(last).padStart(2, "0")}`;
}

export function nextPeriodId(id: string): string {
  const [year, month] = id.split("-").map(Number);
  if (month === 12) return `${year + 1}-01`;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function previousPeriodId(id: string): string {
  const [year, month] = id.split("-").map(Number);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

export class PeriodClosedError extends Error {
  constructor(readonly periodId: string) {
    super(`period ${periodId} is closed`);
    this.name = "PeriodClosedError";
  }
}

export class PeriodRegistry {
  private periods = new Map<string, Period>();

  /** Look up a period, creating it as open the first time it is touched. */
  ensure(id: string): Period {
    let period = this.periods.get(id);
    if (!period) {
      const [year, month] = id.split("-").map(Number);
      period = { id, year, month, status: "open", closedAt: null, closedBy: null };
      this.periods.set(id, period);
    }
    return period;
  }

  isOpen(id: string): boolean {
    return this.ensure(id).status === "open";
  }

  close(id: string, by: string): Period {
    const period = this.ensure(id);
    period.status = "closed";
    period.closedAt = new Date().toISOString();
    period.closedBy = by;
    return period;
  }

  /** Reopen a closed period. Locked periods cannot be reopened. */
  reopen(id: string): Period {
    const period = this.ensure(id);
    if (period.status === "locked") {
      throw new Error(`period ${id} is locked and cannot be reopened`);
    }
    period.status = "open";
    period.closedAt = null;
    period.closedBy = null;
    return period;
  }

  /** Permanently seal a period, typically after the audit. */
  lock(id: string): Period {
    const period = this.ensure(id);
    period.status = "locked";
    return period;
  }

  list(): Period[] {
    return [...this.periods.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** The earliest period still open. */
  earliestOpen(): Period | undefined {
    return this.list().find((p) => p.status === "open");
  }
}
