import type { Heading, TocNode, TocOptions } from "./types.js";

/**
 * Turn a flat heading list into a tree, honouring the level filters.
 */
export function buildTree(headings: Heading[], options: TocOptions): TocNode[] {
  let filtered = headings.filter(
    (h) => h.level >= options.minLevel && h.level <= options.maxLevel,
  );

  if (options.skipTitle) {
    const firstH1 = filtered.findIndex((h) => h.level === 1);
    if (firstH1 >= 0) {
      filtered.splice(firstH1, 1);
    }
  }

  const roots: TocNode[] = [];
  const stack: TocNode[] = [];

  for (const heading of filtered) {
    const node: TocNode = { ...heading, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return roots;
}

/** Depth-first walk, parents before children. */
export function walk(nodes: TocNode[], visit: (node: TocNode, depth: number) => void, depth = 0): void {
  for (const node of nodes) {
    visit(node, depth);
    walk(node.children, visit, depth + 1);
  }
}

export function countNodes(nodes: TocNode[]): number {
  let n = 0;
  walk(nodes, () => n++);
  return n;
}

/** Deepest nesting level present in the tree, 1-based. */
export function maxDepth(nodes: TocNode[]): number {
  let deepest = 0;
  walk(nodes, (_node, depth) => {
    if (depth > deepest) deepest = depth;
  });
  return deepest + 1;
}
