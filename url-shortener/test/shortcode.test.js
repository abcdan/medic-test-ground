const test = require("node:test");
const assert = require("node:assert");
const { encode, decode, codeFor } = require("../src/shortcode");

test("encode/decode roundtrip", () => {
  for (const n of [1, 62, 63, 100000, 987654]) {
    assert.strictEqual(decode(encode(n)), n);
  }
});

test("codes are stable for a sequence", () => {
  assert.strictEqual(codeFor(1), codeFor(1));
  assert.notStrictEqual(codeFor(1), codeFor(2));
});
