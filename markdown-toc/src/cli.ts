#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { generate, update, lint } from "./index.js";
import type { TocOptions } from "./types.js";

const HELP = `mdtoc - generate a table of contents for markdown

usage:
  mdtoc <file.md>              print the toc
  mdtoc --write <file.md>      splice the toc into the file
  mdtoc --lint <file.md>       report broken anchors and level jumps

options:
  --min <n>       lowest heading level to include (default 1)
  --max <n>       highest heading level to include (default 6)
  --ordered       numbered list instead of bullets
  --indent <n>    spaces per nesting level (default 2)
  --skip-title    omit the first h1
`;

export function run(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      write: { type: "boolean", default: false },
      lint: { type: "boolean", default: false },
      ordered: { type: "boolean", default: false },
      "skip-title": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      min: { type: "string" },
      max: { type: "string" },
      indent: { type: "string" },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return values.help ? 0 : 1;
  }

  const file = positionals[0];
  const source = readFileSync(file, "utf8");

  const options: Partial<TocOptions> = {
    ordered: values.ordered,
    skipTitle: values["skip-title"],
  };
  if (values.min) options.minLevel = parseInt(values.min);
  if (values.max) options.maxLevel = parseInt(values.max);
  if (values.indent) options.indent = parseInt(values.indent);

  if (values.lint) {
    const problems = lint(source);
    for (const p of problems) process.stdout.write(p + "\n");
    return problems.length === 0 ? 0 : 1;
  }

  if (values.write) {
    const next = update(source, options);
    if (next !== source) {
      writeFileSync(file, next);
      process.stdout.write(`updated ${file}\n`);
    } else {
      process.stdout.write(`${file} already up to date\n`);
    }
    return 0;
  }

  process.stdout.write(generate(source, options).markdown + "\n");
  return 0;
}

process.exitCode = run(process.argv.slice(2));
