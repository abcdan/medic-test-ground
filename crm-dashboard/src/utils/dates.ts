/** Date helpers. Everything takes and returns ISO strings. */

const DAY_MS = 24 * 60 * 60 * 1000;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfMonth(date: string): string {
  return date.slice(0, 7) + "-01";
}

export function endOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return `${date.slice(0, 7)}-${last}`;
}

export function startOfQuarter(date: string): string {
  const month = Number(date.slice(5, 7));
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
  return `${date.slice(0, 4)}-${String(quarterStart).padStart(2, "0")}-01`;
}

/** "3 days ago", "in 2 weeks", "just now". */
export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diffMs / 1000);

  if (Math.abs(seconds) < 60) return "just now";

  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
    [2592000, "month"],
    [31536000, "year"],
  ];

  for (let i = units.length - 1; i >= 0; i--) {
    const [size, name] = units[i];
    if (Math.abs(seconds) >= size) {
      const count = Math.floor(Math.abs(seconds) / size);
      const plural = count === 1 ? name : `${name}s`;
      return seconds > 0 ? `${count} ${plural} ago` : `in ${count} ${plural}`;
    }
  }

  return "just now";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false;
  return new Date(dueAt) < new Date();
}

export function isThisMonth(iso: string): boolean {
  return iso.slice(0, 7) === today().slice(0, 7);
}

/** Inclusive range check on YYYY-MM-DD strings. */
export function withinRange(date: string, from: string | null, to: string | null): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
