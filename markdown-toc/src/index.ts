import { DEFAULT_OPTIONS, type TocOptions } from "./types.js";
import { parseHeadings } from "./parse.js";
import { buildTree, countNodes, maxDepth } from "./tree.js";
import { renderTree, injectToc, isUpToDate } from "./render.js";
import { findBrokenLinks } from "./links.js";

export * from "./types.js";
export { parseHeadings, collectAnchors } from "./parse.js";
export { buildTree, walk, countNodes, maxDepth } from "./tree.js";
export { renderTree, injectToc, isUpToDate, BEGIN_MARKER, END_MARKER } from "./render.js";
export { findBrokenLinks } from "./links.js";
export { Slugger, slugify } from "./slug.js";
export { stripInline } from "./inline.js";

export interface TocResult {
  markdown: string;
  headingCount: number;
  depth: number;
}

/** Build a table of contents for a markdown document. */
export function generate(source: string, options: Partial<TocOptions> = {}): TocResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const tree = buildTree(parseHeadings(source), opts);
  return {
    markdown: renderTree(tree, opts),
    headingCount: countNodes(tree),
    depth: maxDepth(tree),
  };
}

/** Build the toc and splice it into the document. */
export function update(source: string, options: Partial<TocOptions> = {}): string {
  const { markdown } = generate(source, options);
  if (isUpToDate(source, markdown)) return source;
  return injectToc(source, markdown);
}

/** Lint a document: returns human readable problems, empty when clean. */
export function lint(source: string): string[] {
  const problems: string[] = [];

  for (const link of findBrokenLinks(source)) {
    problems.push(`line ${link.line}: link "${link.label}" points at missing anchor #${link.fragment}`);
  }

  const headings = parseHeadings(source);
  let previous = 0;
  for (const h of headings) {
    if (previous && h.level > previous + 1) {
      problems.push(`line ${h.line + 1}: heading level jumps from h${previous} to h${h.level}`);
    }
    previous = h.level;
  }

  return problems;
}
