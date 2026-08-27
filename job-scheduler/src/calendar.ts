/**
 * Blackout windows and business hours.
 *
 * A job can be held back outside its allowed window rather than skipped, so
 * a nightly job that becomes due during a deploy freeze runs as soon as the
 * freeze lifts.
 */

export interface Window {
  /** 0 = Sunday. */
  daysOfWeek: number[];
  /** Minutes since local midnight. */
  startMinute: number;
  endMinute: number;
}

export interface Blackout {
  name: string;
  /** Epoch millis, inclusive. */
  from: number;
  /** Epoch millis, exclusive. */
  to: number;
}

export const BUSINESS_HOURS: Window = {
  daysOfWeek: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
};

export const OUT_OF_HOURS: Window = {
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startMinute: 22 * 60,
  endMinute: 6 * 60,
};

export class Calendar {
  private blackouts: Blackout[] = [];

  addBlackout(blackout: Blackout): void {
    if (blackout.to <= blackout.from) {
      throw new Error(`blackout "${blackout.name}" ends before it starts`);
    }
    this.blackouts.push(blackout);
  }

  removeBlackout(name: string): boolean {
    const before = this.blackouts.length;
    this.blackouts = this.blackouts.filter((b) => b.name !== name);
    return this.blackouts.length < before;
  }

  /** The blackout covering an instant, if any. */
  blackoutAt(at: number): Blackout | undefined {
    return this.blackouts.find((b) => at >= b.from && at < b.to);
  }

  /** True when the instant falls inside the window and no blackout applies. */
  isOpen(at: number, window: Window): boolean {
    if (this.blackoutAt(at)) return false;

    const date = new Date(at);
    if (!window.daysOfWeek.includes(date.getDay())) return false;

    const minute = date.getHours() * 60 + date.getMinutes();
    return minute >= window.startMinute && minute < window.endMinute;
  }

  /**
   * Move an instant forward to the next moment the window is open. Returns
   * the input unchanged when it is already open.
   */
  nextOpen(at: number, window: Window): number {
    let cursor = at;
    for (let i = 0; i < 60 * 24 * 14; i++) {
      if (this.isOpen(cursor, window)) return cursor;
      cursor += 60_000;
    }
    throw new Error("no open window within two weeks");
  }

  list(): Blackout[] {
    return [...this.blackouts];
  }
}
