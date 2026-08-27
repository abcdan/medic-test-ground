import test from "node:test";
import assert from "node:assert";
import { generate, update, BEGIN_MARKER } from "../src/index.js";

const DOC = `# Title

## Install

## Usage

### Flags
`;

test("renders a nested list", () => {
  const { markdown, headingCount } = generate(DOC);
  assert.equal(headingCount, 4);
  assert.match(markdown, /- \[Title\]\(#title\)/);
  assert.match(markdown, /^ {4}- \[Flags\]\(#flags\)$/m);
});

test("injects markers when absent", () => {
  const out = update(DOC);
  assert.ok(out.startsWith(BEGIN_MARKER));
});
