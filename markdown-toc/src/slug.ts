/**
 * GitHub-compatible heading slugs.
 *
 * Lowercase, strip punctuation, spaces become dashes. Duplicate slugs within
 * a document get a numeric suffix: `intro`, `intro-1`, `intro-2`.
 */

const PUNCTUATION = /[!"#$%&'()*+,./:;<=>?@[\]^`{|}~]/g;

export class Slugger {
  private seen = new Map<string, number>();

  reset(): void {
    this.seen.clear();
  }

  slug(text: string): string {
    const base = text
      .trim()
      .toLowerCase()
      .replace(PUNCTUATION, "")
      .replace(/\s+/g, "-");

    const count = this.seen.get(base) ?? 0;
    this.seen.set(base, count + 1);

    if (count === 0) {
      return base;
    }
    return `${base}-${count}`;
  }
}

/** One-shot slug for callers that do not care about collisions. */
export function slugify(text: string): string {
  return new Slugger().slug(text);
}
