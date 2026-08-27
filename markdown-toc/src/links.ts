import { collectAnchors } from "./parse.js";

export interface BrokenLink {
  fragment: string;
  line: number;
  label: string;
}

const INTERNAL_LINK = /\[([^\]]*)\]\((#[^)]+)\)/g;

/**
 * Find in-document links whose target fragment does not exist.
 */
export function findBrokenLinks(source: string): BrokenLink[] {
  const anchors = collectAnchors(source);
  const broken: BrokenLink[] = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const match of line.matchAll(INTERNAL_LINK)) {
      const fragment = match[2].slice(1);
      if (!anchors.has(fragment.toLowerCase())) {
        broken.push({ fragment, line: index + 1, label: match[1] });
      }
    }
  });

  return broken;
}
