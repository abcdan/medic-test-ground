# markdown-toc

Generates a table of contents for a markdown file, with GitHub-compatible
heading anchors.

```
npm install
npm run build
node dist/src/cli.js README.md
```

## Features

- ATX (`## Heading`) and setext (`Heading` + `---`) headings
- YAML front matter is skipped
- Fenced code blocks are skipped, so `# comments` in shell samples don't
  become entries
- Inline markdown (links, emphasis, code, images) is stripped from labels
- Duplicate headings get `-1`, `-2` suffixes like GitHub does
- `--write` splices the toc between `<!-- toc -->` / `<!-- /toc -->` markers
- `--lint` reports links pointing at anchors that don't exist, and heading
  levels that skip a step

## Options

| Flag | Meaning |
| --- | --- |
| `--min <n>` | Lowest heading level to include |
| `--max <n>` | Highest heading level to include |
| `--ordered` | Numbered list instead of bullets |
| `--indent <n>` | Spaces per nesting level |
| `--skip-title` | Omit the first H1 |
