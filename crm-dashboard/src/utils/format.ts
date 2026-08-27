/** Display formatting helpers. */

/** Format an amount in cents as currency. */
export function formatMoney(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** Compact form for dashboard tiles: €1.2M, €340k. */
export function formatCompactMoney(cents: number, currency = "EUR"): string {
  const value = cents / 100;
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency + " ";

  if (value >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${symbol}${Math.round(value / 1_000)}k`;
  return `${symbol}${value.toFixed(0)}`;
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

export function initials(firstName: string, lastName: string): string {
  return (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
}

export function fullName(contact: { firstName: string; lastName: string }): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

/** Cut a string at a word boundary. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return cut.slice(0, lastSpace) + "…";
}

/** Turn "closed-won" into "Closed won". */
export function humanise(slug: string): string {
  const spaced = slug.replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Deterministic colour for an avatar or tag chip. */
export function colourFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

/** Highlight the matching part of a search result. */
export function highlight(text: string, term: string): string {
  if (!term) return text;
  const pattern = new RegExp(`(${term})`, "gi");
  return text.replace(pattern, "<mark>$1</mark>");
}
