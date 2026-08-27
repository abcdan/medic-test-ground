import test from "node:test";
import assert from "node:assert";
import { Slugger, slugify } from "../src/slug.js";

test("basic slugs", () => {
  assert.equal(slugify("Getting Started"), "getting-started");
  assert.equal(slugify("What's new?"), "whats-new");
});

test("duplicates get suffixes", () => {
  const s = new Slugger();
  assert.equal(s.slug("Intro"), "intro");
  assert.equal(s.slug("Intro"), "intro-1");
  assert.equal(s.slug("Intro"), "intro-2");
});
