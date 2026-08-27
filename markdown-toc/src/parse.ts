import type { Heading } from "./types.js";
import { Slugger } from "./slug.js";
import { stripInline } from "./inline.js";

const ATX = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const SETEXT_H1 = /^=+\s*$/;
const SETEXT_H2 = /^-{2,}\s*$/;
const FRONT_MATTER = /^---\s*$/;

/**
 * Pull every heading out of a markdown document.
 *
 * Supports ATX (`## Title`) and setext (`Title` followed by `---`) headings.
 * YAML front matter at the top of the file is skipped. Fenced code blocks are
 * skipped so that shell comments do not turn into headings.
 */
export function parseHeadings(source: string): Heading[] {
  const lines = source.split(/\r?\n/);
  const slugger = new Slugger();
  const headings: Heading[] = [];

  let inFence = false;
  let start = 0;

  if (lines.length > 0 && FRONT_MATTER.test(lines[0])) {
    for (let i = 1; i < lines.length; i++) {
      if (FRONT_MATTER.test(lines[i])) {
        start = i + 1;
        break;
      }
    }
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      headings.push(makeHeading(atx[1].length, atx[2], i, slugger));
      continue;
    }

    const next = lines[i + 1];
    if (next && line.trim().length > 0) {
      if (SETEXT_H1.test(next)) {
        headings.push(makeHeading(1, line.trim(), i, slugger));
        i++;
      } else if (SETEXT_H2.test(next)) {
        headings.push(makeHeading(2, line.trim(), i, slugger));
        i++;
      }
    }
  }

  return headings;
}

function makeHeading(level: number, raw: string, line: number, slugger: Slugger): Heading {
  const text = stripInline(raw);
  return { level, raw, text, slug: slugger.slug(text), line };
}

/** Every fragment the document defines, for link checking. */
export function collectAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  for (const h of parseHeadings(source)) {
    anchors.add(h.slug);
  }
  const explicit = source.matchAll(/<a\s+(?:id|name)="([^"]+)"/g);
  for (const m of explicit) {
    anchors.add(m[1]);
  }
  return anchors;
}
