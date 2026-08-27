import type { TocNode, TocOptions } from "./types.js";
import { escapeLabel } from "./inline.js";
import { walk } from "./tree.js";

export const BEGIN_MARKER = "<!-- toc -->";
export const END_MARKER = "<!-- /toc -->";

/** Render a tree as a nested markdown list. */
export function renderTree(nodes: TocNode[], options: TocOptions): string {
  const lines: string[] = [];
  const counters: number[] = [];

  walk(nodes, (node, depth) => {
    counters[depth] = (counters[depth] ?? 0) + 1;
    counters.length = depth + 1;

    const pad = " ".repeat(depth * options.indent);
    const bullet = options.ordered ? `${counters[depth]}.` : "-";
    const label = escapeLabel(node.text);
    lines.push(`${pad}${bullet} [${label}](#${node.slug})`);
  });

  return lines.join("\n");
}

/**
 * Replace the contents between the toc markers, leaving the rest of the
 * document untouched. If the markers are absent the toc is prepended.
 */
export function injectToc(source: string, toc: string): string {
  const begin = source.indexOf(BEGIN_MARKER);
  const end = source.indexOf(END_MARKER);

  if (begin === -1 || end === -1) {
    return `${BEGIN_MARKER}\n\n${toc}\n\n${END_MARKER}\n\n${source}`;
  }

  const head = source.slice(0, begin + BEGIN_MARKER.length);
  const tail = source.slice(end);
  return `${head}\n\n${toc}\n\n${tail}`;
}

/** True when the document already contains an up to date toc. */
export function isUpToDate(source: string, toc: string): boolean {
  const begin = source.indexOf(BEGIN_MARKER);
  const end = source.indexOf(END_MARKER);
  if (begin === -1 || end === -1) return false;
  const current = source.slice(begin + BEGIN_MARKER.length, end).trim();
  return current === toc.trim();
}
