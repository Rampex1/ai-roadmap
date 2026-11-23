#!/usr/bin/env node
// Cross-file content checks that Zod schemas can't express: unique ids, references,
// prereq cycles, reserved slugs, and MDX component ids.
// Usage: node scripts/check-content.mjs [--root src/content]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const RESERVED = new Set(['check', 'homework', 'capstone', 'index']);
const QUIZ_TYPES = new Set(['mcq', 'multi', 'numeric', 'output', 'order', 'cloze']);

const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.split(sep).some((p) => p.startsWith('_'))).map((f) => join(dir, f))
    : [];
// Paths in messages: relative to cwd when inside it, else absolute.
const rel = (f) => (relative(process.cwd(), f).startsWith('..') ? f : relative(process.cwd(), f));
const slugOf = (file, base, ext) => relative(base, file).split(sep).join('/').replace(ext, '').toLowerCase();

export function checkContent(root) {
  const errors = [];
  const err = (file, msg) => errors.push(`${rel(file)}: ${msg}`);

  // Load a flat collection of YAML files: Map<slug, {file, data}>.
  const loadYaml = (name, re = /\.ya?ml$/) => {
    const base = join(root, name);
    const out = new Map();
    for (const file of walk(base).filter((f) => re.test(f))) {
      try {
        const slug = slugOf(file, base, /\.ya?ml$/);
        if (out.has(slug)) err(file, `slug "${slug}" collides with ${rel(out.get(slug).file)}`);
        out.set(slug, { file, data: parse(readFileSync(file, 'utf8')) ?? {} });
      } catch (e) {
        err(file, `invalid YAML: ${e.message}`);
      }
    }
    return out;
  };

  const modules = loadYaml('modules');
  const quizzes = loadYaml('quizzes');
  const exercises = loadYaml('exercises');
  const homework = loadYaml('homework');
  const glossary = loadYaml('glossary');
  const resources = loadYaml('resources');

  // Docs: frontmatter + body.
  const docsBase = join(root, 'docs');
  const lessons = new Map();
  for (const file of walk(docsBase).filter((f) => /\.mdx?$/.test(f))) {
    const src = readFileSync(file, 'utf8');
    const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let fm = {};
    try {
      fm = m ? parse(m[1]) ?? {} : {};
    } catch (e) {
      err(file, `invalid frontmatter: ${e.message}`);
    }
    const id = slugOf(file, docsBase, /\.mdx?$/);
    if (fm.template === 'splash') continue; // home / landing pages are not lessons
    lessons.set(id, { file, fm, body: m ? src.slice(m[0].length) : src });
  }

  // Unique ids within each id-bearing collection; id must match the filename.
  for (const [name, coll] of [['module', modules], ['exercise', exercises], ['homework', homework]]) {
    const seen = new Map();
    for (const [slug, { file, data }] of coll) {
      if (seen.has(data.id)) err(file, `duplicate ${name} id "${data.id}" (also in ${rel(seen.get(data.id))})`);
      else seen.set(data.id, file);
      if (data.id !== slug) err(file, `${name} id "${data.id}" must match its filename "${slug}"`);
    }
  }
  const moduleIds = new Set([...modules.values()].map((m) => m.data.id));
  const homeworkById = new Map([...homework.values()].map((h) => [h.data.id, h.data]));

  // Modules: prereqs exist, capstone refers to a capstone homework.
  for (const { file, data } of modules.values()) {
    for (const p of data.prereqs ?? []) if (!moduleIds.has(p)) err(file, `prereq "${p}" is not a module`);
    if (data.capstone) {
      const h = homeworkById.get(data.capstone);
      if (!h) err(file, `capstone "${data.capstone}" is not a homework id`);
      else if (h.kind !== 'capstone') err(file, `capstone "${data.capstone}" has kind "${h.kind}", expected "capstone"`);
      else if (h.module !== data.id) err(file, `capstone "${data.capstone}" belongs to module "${h.module}", expected "${data.id}"`);
    }
  }

  // Prereq graph must be acyclic.
  const graph = new Map([...modules.values()].map(({ data }) => [data.id, data.prereqs ?? []]));
  const state = new Map(); // 1 = visiting, 2 = done
  const visit = (id, path) => {
    if (state.get(id) === 2 || !graph.has(id)) return;
    if (state.get(id) === 1) {
      const cycle = [...path.slice(path.indexOf(id)), id].join(' -> ');
      err(modules.get(id)?.file ?? id, `prereq cycle: ${cycle}`);
      return;
    }
    state.set(id, 1);
    for (const p of graph.get(id)) visit(p, [...path, id]);
    state.set(id, 2);
  };
  for (const id of graph.keys()) visit(id, []);

  // Lessons.
  for (const [id, { file, fm, body }] of lessons) {
    const parts = id.split('/');
    const slug = parts.at(-1);
    if (RESERVED.has(slug)) err(file, `lesson slug "${slug}" is reserved (${[...RESERVED].join(', ')})`);
    if (parts.length !== 3) err(file, `lesson must live at <course>/<module>/<slug>.mdx, got "${id}"`);
    if (!fm.module) err(file, 'missing frontmatter "module"');
    else if (!moduleIds.has(fm.module)) err(file, `module "${fm.module}" does not exist`);
    else {
      const mod = [...modules.values()].find((m) => m.data.id === fm.module).data;
      if (parts.length === 3 && (parts[0] !== mod.course || parts[1] !== mod.id))
        err(file, `lesson path "${id}" does not match module ${mod.id} in course ${mod.course}`);
    }
    if (fm.goDeeper && !resources.has(fm.goDeeper)) err(file, `goDeeper "${fm.goDeeper}" is not a resource`);
    for (const [, x] of body.matchAll(/<CodeExercise\b[^>]*\bid=["']([^"']+)["']/g))
      if (!exercises.has(x)) err(file, `<CodeExercise id="${x}"> does not exist`);
    for (const [, t] of body.matchAll(/<Term\b[^>]*\bid=["']([^"']+)["']/g))
      if (!glossary.has(t)) err(file, `<Term id="${t}"> is not a glossary entry`);
  }

  // Ordering must be unambiguous: module order unique per course, lesson order unique per module.
  const dupOrder = (items, keyOf, what) => {
    const seen = new Map();
    for (const { file, key, order } of items) {
      if (order === undefined) continue;
      const k = `${key}#${order}`;
      if (seen.has(k)) err(file, `${what} order ${order} duplicates ${rel(seen.get(k))}`);
      else seen.set(k, file);
    }
  };
  dupOrder([...modules.values()].map(({ file, data }) => ({ file, key: data.course, order: data.order })), null, 'module');
  dupOrder([...lessons.values()].map(({ file, fm }) => ({ file, key: fm.module, order: fm.order })), null, 'lesson');

  // Quizzes: one file per lesson, item ids unique site-wide, valid types.
  const itemIds = new Map();
  for (const [slug, { file, data }] of quizzes) {
    if (!lessons.has(slug)) err(file, `no lesson "${slug}" for this quiz (path must mirror src/content/docs)`);
    if (!Array.isArray(data.items)) {
      err(file, 'quiz file must be an object with an "items" array');
      continue;
    }
    data.items.forEach((item, i) => {
      const where = `items[${i}]${item?.id ? ` (${item.id})` : ''}`;
      if (!item?.id) err(file, `${where}: missing id`);
      else if (itemIds.has(item.id)) err(file, `${where}: duplicate quiz item id (also in ${rel(itemIds.get(item.id))})`);
      else itemIds.set(item.id, file);
      if (!QUIZ_TYPES.has(item?.type)) err(file, `${where}: invalid type "${item?.type}" (expected ${[...QUIZ_TYPES].join('|')})`);
    });
  }

  for (const { file, data } of exercises.values())
    if (!lessons.has(data.lesson)) err(file, `lesson "${data.lesson}" does not exist`);
  for (const { file, data } of homework.values())
    if (!moduleIds.has(data.module)) err(file, `module "${data.module}" does not exist`);
  for (const { file, data } of glossary.values())
    for (const r of data.related ?? []) if (!glossary.has(r)) err(file, `related term "${r}" does not exist`);
  for (const { file, data } of resources.values())
    for (const m of data.modules ?? []) if (!moduleIds.has(m)) err(file, `module "${m}" does not exist`);

  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = resolve(i > -1 ? process.argv[i + 1] : 'src/content');
  if (!existsSync(root)) {
    console.error(`check-content: root "${root}" does not exist`);
    process.exit(2);
  }
  const errors = checkContent(root);
  if (errors.length) {
    console.error(`check-content: ${errors.length} problem(s)\n` + errors.map((e) => `  ✗ ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('check-content: OK');
}
