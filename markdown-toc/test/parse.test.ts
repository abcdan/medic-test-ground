import test from "node:test";
import assert from "node:assert";
import { parseHeadings } from "../src/parse.js";

test("reads atx headings", () => {
  const h = parseHeadings("# One\n\ntext\n\n## Two\n");
  assert.equal(h.length, 2);
  assert.equal(h[0].level, 1);
  assert.equal(h[1].text, "Two");
});

test("reads setext headings", () => {
  const h = parseHeadings("Title\n=====\n\nSub\n---\n");
  assert.equal(h.length, 2);
  assert.equal(h[0].level, 1);
  assert.equal(h[1].level, 2);
});

test("skips front matter", () => {
  const h = parseHeadings("---\ntitle: x\n---\n\n# Real\n");
  assert.equal(h.length, 1);
  assert.equal(h[0].text, "Real");
});

test("ignores headings inside fences", () => {
  const h = parseHeadings("# Real\n\n```\n# not a heading\n```\n\n## Also real\n");
  assert.equal(h.length, 2);
});
