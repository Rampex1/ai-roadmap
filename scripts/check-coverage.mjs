#!/usr/bin/env node
// Course completeness: every module with lessons has ≥8 quiz items per lesson and a homework notebook;
// with --strict every module must have lessons and capstones must not be placeholders.
// Usage: node scripts/check-coverage.mjs [--root src/content] [--public public] [--strict]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const MIN_ITEMS = 8;
const yamls = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => parse(readFileSync(join(dir, f), 'utf8')) ?? {}) : []);

export function checkCoverage(root, { strict = false, publicDir = resolve(root, '../../public') } = {}) {
  const errors = [];
  const modules = yamls(join(root, 'modules'));
  const homework = yamls(join(root, 'homework'));
  const docsDir = join(root, 'docs');
  const lessons = existsSync(docsDir)
    ? readdirSync(docsDir, { recursive: true }).map(String).filter((f) => /\.mdx?$/.test(f)).flatMap((f) => {
        const fm = readFileSync(join(docsDir, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const data = fm ? parse(fm[1]) ?? {} : {};
        return data.module && !data.overview && data.template !== 'splash' ? [{ id: f.split(sep).join('/').replace(/\.mdx?$/, ''), module: data.module }] : [];
      })
    : [];
  for (const m of modules) {
    const mine = lessons.filter((l) => l.module === m.id);
    if (!mine.length) {
      if (strict) errors.push(`module ${m.id}: no lessons`);
    } else {
      for (const l of mine) {
        const q = join(root, 'quizzes', `${l.id}.yaml`);
        const n = existsSync(q) ? (parse(readFileSync(q, 'utf8'))?.items ?? []).length : 0;
        if (n < MIN_ITEMS) errors.push(`lesson ${l.id}: ${n} quiz items (need at least ${MIN_ITEMS})`);
      }
      const hw = homework.filter((h) => h.module === m.id && h.kind === 'homework');
      if (!hw.length) errors.push(`module ${m.id}: no homework`);
      for (const h of hw) if (!existsSync(join(publicDir, h.notebook ?? ''))) errors.push(`module ${m.id}: homework ${h.id} notebook ${h.notebook} is missing`);
    }
    if (m.capstone && (strict || mine.length)) {
      const cap = homework.find((h) => h.id === m.capstone);
      if (cap && /placeholder/i.test(cap.brief ?? '')) errors.push(`capstone ${cap.id}: brief is still a Placeholder`);
      if (cap && !existsSync(join(publicDir, cap.notebook ?? ''))) errors.push(`capstone ${cap.id}: notebook ${cap.notebook} is missing`);
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => (process.argv.includes(name) ? resolve(process.argv[process.argv.indexOf(name) + 1]) : def);
  const root = arg('--root', resolve('src/content'));
  const errors = checkCoverage(root, { strict: process.argv.includes('--strict'), publicDir: arg('--public', resolve('public')) });
  if (errors.length) {
    console.error(`check-coverage: ${errors.length} problem(s)\n` + errors.map((e) => `  ✗ ${e}`).join('\n'));
    process.exit(1);
  }
  console.log(`check-coverage: OK${process.argv.includes('--strict') ? ' (strict)' : ''}`);
}
