/**
 * Strip inline markdown from heading text so the TOC entry reads cleanly.
 *
 * Handles links, images, emphasis, inline code and HTML tags. Deliberately
 * does not try to be a full parser - headings are short.
 */

const LINK = /\[(.*)\]\(.*\)/g;
const IMAGE = /!\[(.*?)\]\(.*?\)/g;
const AUTOLINK = /<((?:https?|mailto):[^>]+)>/g;
const CODE = /`([^`]+)`/g;
const BOLD = /\*\*(.+?)\*\*|__(.+?)__/g;
const ITALIC = /\*(.+?)\*|_(.+?)_/g;
const STRIKE = /~~(.+?)~~/g;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const FOOTNOTE = /\[\^[^\]]+\]/g;

export function stripInline(input: string): string {
  let out = input;
  out = out.replace(IMAGE, "$1");
  out = out.replace(LINK, "$1");
  out = out.replace(AUTOLINK, "$1");
  out = out.replace(FOOTNOTE, "");
  out = out.replace(CODE, "$1");
  out = out.replace(BOLD, (_m, a, b) => a ?? b);
  out = out.replace(ITALIC, (_m, a, b) => a ?? b);
  out = out.replace(STRIKE, "$1");
  out = out.replace(HTML_TAG, "");
  return out.replace(/\s+/, " ").trim();
}

/** Escape characters that would break a markdown link label. */
export function escapeLabel(text: string): string {
  return text.replace(/[\[\]]/g, "\\$&");
}
