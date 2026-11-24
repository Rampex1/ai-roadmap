#!/usr/bin/env node
// Compile every lesson MDX the way the site does (GFM tables + math) to catch syntax errors
// without a full build — e.g. a raw "<" in prose, or "|" inside inline code in a table cell.
// Usage: node scripts/check-mdx.mjs [paths or dirs...]   (default: src/content/docs)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

const files = (paths) =>
  paths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p, { recursive: true }).map(String).filter((f) => f.endsWith('.mdx')).map((f) => join(p, f)) : [p]));

export async function checkMdx(paths) {
  const errors = [];
  for (const f of files(paths)) {
    const src = readFileSync(f, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---/, (m) => m.replace(/[^\n]/g, ' '));
    try {
      await compile(src, { remarkPlugins: [remarkGfm, remarkMath] });
    } catch (e) {
      const where = e.place?.start ? `:${e.place.start.line}:${e.place.start.column}` : e.line ? `:${e.line}:${e.column}` : '';
      errors.push(`${relative(process.cwd(), f)}${where}: ${e.reason ?? e.message}`);
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const errors = await checkMdx(args.length ? args : ['src/content/docs']);
  if (errors.length) {
    console.error(`check-mdx: ${errors.length} problem(s)\n` + errors.map((e) => `  ✗ ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('check-mdx: OK');
}
