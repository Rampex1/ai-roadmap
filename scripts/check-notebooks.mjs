#!/usr/bin/env node
// Every homework notebook must be valid nbformat 4 JSON (opens in Jupyter and Colab).
// Usage: node scripts/check-notebooks.mjs [--dir public/homework]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT_TYPES = ['stream', 'display_data', 'execute_result', 'error'];
const isSource = (s) => typeof s === 'string' || (Array.isArray(s) && s.every((x) => typeof x === 'string'));

export function checkNotebooks(dir) {
  if (!existsSync(dir)) return [];
  const errors = [];
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.ipynb'));
  for (const f of files) {
    const file = join(dir, f);
    const name = relative(process.cwd(), file);
    let nb;
    try {
      nb = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      errors.push(`${name}: not valid JSON (${e.message})`);
      continue;
    }
    if (nb?.nbformat !== 4) errors.push(`${name}: nbformat must be 4`);
    if (!Number.isInteger(nb?.nbformat_minor)) errors.push(`${name}: nbformat_minor must be an integer`);
    if (typeof nb?.metadata !== 'object' || nb.metadata === null || Array.isArray(nb.metadata)) errors.push(`${name}: metadata must be an object`);
    if (!Array.isArray(nb?.cells)) {
      errors.push(`${name}: cells must be an array`);
      continue;
    }
    nb.cells.forEach((c, i) => {
      if (!['code', 'markdown', 'raw'].includes(c?.cell_type)) errors.push(`${name}: cell ${i} has invalid cell_type "${c?.cell_type}"`);
      if (!isSource(c?.source)) errors.push(`${name}: cell ${i} source must be a string or list of strings`);
      if (typeof c?.metadata !== 'object' || c.metadata === null || Array.isArray(c.metadata)) errors.push(`${name}: cell ${i} metadata must be an object`);
      if (c?.cell_type === 'code') {
        if (!Array.isArray(c.outputs)) errors.push(`${name}: code cell ${i} needs an outputs array`);
        else c.outputs.forEach((o, j) => {
          if (!OUTPUT_TYPES.includes(o?.output_type)) errors.push(`${name}: code cell ${i} output ${j} has invalid output_type "${o?.output_type}"`);
        });
        if (!(c.execution_count === null || Number.isInteger(c.execution_count))) errors.push(`${name}: code cell ${i} execution_count must be null or an integer`);
      } else if (c && ('outputs' in c || 'execution_count' in c)) {
        errors.push(`${name}: ${c.cell_type} cell ${i} must not have outputs or execution_count`);
      }
    });
  }
  return errors;
}

/** Every homework entry's notebook must exist under public/. Capstones may ship later: warnings only. */
export function checkHomeworkNotebooks(homeworkDir, publicDir) {
  const errors = [];
  const warnings = [];
  if (!existsSync(homeworkDir)) return { errors, warnings };
  for (const f of readdirSync(homeworkDir).filter((x) => /\.ya?ml$/.test(x))) {
    const text = readFileSync(join(homeworkDir, f), 'utf8');
    const notebook = text.match(/^notebook:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1];
    const kind = text.match(/^kind:\s*["']?(\w+)/m)?.[1];
    if (!notebook || existsSync(join(publicDir, notebook))) continue;
    (kind === 'capstone' ? warnings : errors).push(`${f}: notebook ${notebook} is missing from public/`);
  }
  return { errors, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--dir');
  const dir = resolve(i > -1 ? process.argv[i + 1] : 'public/homework');
  const hw = checkHomeworkNotebooks(resolve('src/content/homework'), resolve('public'));
  hw.warnings.forEach((w) => console.warn(`check-notebooks: warning: ${w}`));
  const errors = [...checkNotebooks(dir), ...(i > -1 ? [] : hw.errors)];
  if (errors.length) {
    console.error(`check-notebooks: ${errors.length} problem(s)\n` + errors.map((e) => `  ✗ ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('check-notebooks: OK');
}
