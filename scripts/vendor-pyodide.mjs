#!/usr/bin/env node
// Self-host Pyodide under public/pyodide/: core files from node_modules/pyodide, plus the wheels
// for the packages exercises use (and their dependency closure) from jsDelivr at the pinned version.
// Idempotent: files already present with the lockfile's sha256 are skipped, so a complete
// directory needs no network. Usage: node scripts/vendor-pyodide.mjs [--if-missing]
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'node_modules/pyodide');
const OUT = join(ROOT, 'public/pyodide');
const PACKAGES = ['numpy', 'pandas', 'matplotlib', 'scikit-learn', 'scipy'];
const CORE = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

const { version } = JSON.parse(readFileSync(join(SRC, 'package.json'), 'utf8'));
const CDN = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

// --if-missing: quick exit when this version is already fully vendored (used before check/build).
const MARK = join(OUT, '.complete');
if (process.argv.includes('--if-missing') && existsSync(MARK) && readFileSync(MARK, 'utf8').trim() === version) process.exit(0);

mkdirSync(OUT, { recursive: true });
for (const f of CORE) {
  const from = join(SRC, f);
  const to = join(OUT, f);
  if (!existsSync(to) || sha256(readFileSync(to)) !== sha256(readFileSync(from))) copyFileSync(from, to);
}

const lock = JSON.parse(readFileSync(join(OUT, 'pyodide-lock.json'), 'utf8')).packages;
const wanted = new Set();
const stack = [...PACKAGES];
while (stack.length) {
  const name = stack.pop();
  if (wanted.has(name)) continue;
  if (!lock[name]) throw new Error(`vendor-pyodide: "${name}" is not in pyodide-lock.json`);
  wanted.add(name);
  stack.push(...lock[name].depends);
}

let fetched = 0;
for (const name of [...wanted].sort()) {
  const { file_name, sha256: want } = lock[name];
  const to = join(OUT, file_name);
  if (existsSync(to) && sha256(readFileSync(to)) === want) continue;
  process.stdout.write(`vendor-pyodide: downloading ${file_name} … `);
  let res;
  try {
    res = await fetch(CDN + file_name);
  } catch (e) {
    console.error(`\nvendor-pyodide: network error fetching ${file_name} (${e.cause?.code ?? e.message}). Connect to the internet once and run "npm run vendor:pyodide".`);
    process.exit(1);
  }
  if (!res.ok) throw new Error(`vendor-pyodide: ${CDN + file_name} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== want) throw new Error(`vendor-pyodide: sha256 mismatch for ${file_name} (got ${got}, want ${want})`);
  writeFileSync(to, buf);
  fetched++;
  console.log(mb(buf.length));
}
writeFileSync(MARK, `${version}\n`);

const files = readdirSync(OUT).filter((f) => !f.startsWith('.'));
const total = files.reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
console.log(`vendor-pyodide: Pyodide ${version}, ${wanted.size} wheels (${fetched} downloaded), ${files.length} files, ${mb(total)} in public/pyodide`);
