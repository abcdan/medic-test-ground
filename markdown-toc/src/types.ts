export interface Heading {
  /** 1-6 */
  level: number;
  /** Raw text as it appeared in the source, minus the leading hashes. */
  raw: string;
  /** Inline markdown stripped, suitable for display. */
  text: string;
  /** URL fragment, unique within the document. */
  slug: string;
  /** Zero-based line index in the source document. */
  line: number;
}

export interface TocNode extends Heading {
  children: TocNode[];
}

export interface TocOptions {
  /** Lowest heading level to include. Default 1. */
  minLevel: number;
  /** Highest heading level to include. Default 6. */
  maxLevel: number;
  /** Emit an ordered list instead of a bulleted one. */
  ordered: boolean;
  /** Number of spaces per nesting level. */
  indent: number;
  /** Skip the first H1, which is usually the document title. */
  skipTitle: boolean;
}

export const DEFAULT_OPTIONS: TocOptions = {
  minLevel: 1,
  maxLevel: 6,
  ordered: false,
  indent: 2,
  skipTitle: false,
};
