const test = require("node:test");
const assert = require("node:assert");
const { isValidTarget, isValidAlias } = require("../src/validate");

test("accepts ordinary urls", () => {
  assert.ok(isValidTarget("https://example.com/a/b?c=1"));
  assert.ok(isValidTarget("example.com"));
});

test("rejects junk", () => {
  assert.ok(!isValidTarget(""));
  assert.ok(!isValidTarget("not a url"));
});

test("alias rules", () => {
  assert.ok(isValidAlias("my-link"));
  assert.ok(!isValidAlias("ab"));
  assert.ok(!isValidAlias("admin"));
});
