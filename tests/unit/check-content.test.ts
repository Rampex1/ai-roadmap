import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkContent } from '../../scripts/check-content.mjs';

const VALID = new URL('../fixtures/content-valid', import.meta.url).pathname;
const SCRIPT = new URL('../../scripts/check-content.mjs', import.meta.url).pathname;
const temps: string[] = [];

// Copy the valid fixture into a temp dir and apply a mutation.
function variant(mutate: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'check-content-'));
  temps.push(root);
  cpSync(VALID, root, { recursive: true });
  mutate(root);
  return root;
}
const write = (root: string, path: string, text: string) => writeFileSync(join(root, path), text);
const edit = (root: string, path: string, fn: (s: string) => string) =>
  write(root, path, fn(readFileSync(join(root, path), 'utf8')));

afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const LESSON = (module: string, body = '') => `---\ntitle: X\nmodule: ${module}\norder: 2\n---\n\n${body}\n`;

describe('checkContent', () => {
  it('returns no errors for the valid fixture', () => {
    expect(checkContent(VALID)).toEqual([]);
  });

  it('reports a quiz item id duplicated across two quiz files', () => {
    const root = variant((r) => {
      write(r, 'docs/demo/m1/second.mdx', LESSON('m1'));
      write(r, 'quizzes/demo/m1/second.yaml', 'items:\n  - id: m1-intro-01\n    type: mcq\n    prompt: dup\n');
    });
    const errors = checkContent(root);
    expect(errors).not.toEqual([]);
    expect(errors.join('\n')).toMatch(/m1-intro-01.*duplicate quiz item id/);
  });

  it('reports a module prereq that points to a missing module', () => {
    const root = variant((r) => edit(r, 'modules/m1.yaml', (s) => s.replace('prereqs: ["m0"]', 'prereqs: ["ghost"]')));
    const errors = checkContent(root);
    expect(errors).not.toEqual([]);
    expect(errors.join('\n')).toMatch(/m1\.yaml: prereq "ghost" is not a module/);
  });

  it('reports a prereq cycle', () => {
    const root = variant((r) => edit(r, 'modules/m0.yaml', (s) => s.replace('prereqs: []', 'prereqs: ["m1"]')));
    const errors = checkContent(root);
    expect(errors).not.toEqual([]);
    expect(errors.join('\n')).toMatch(/prereq cycle: .*m0.*m1|prereq cycle: .*m1.*m0/);
  });

  it('reports a quiz item with type "essay"', () => {
    const root = variant((r) => edit(r, 'quizzes/demo/m1/intro.yaml', (s) => s.replace('type: mcq', 'type: essay')));
    const errors = checkContent(root);
    expect(errors).not.toEqual([]);
    expect(errors.join('\n')).toMatch(/intro\.yaml: .*m1-intro-01.*invalid type "essay"/);
  });

  it('reports the reserved lesson slug "check"', () => {
    const root = variant((r) => write(r, 'docs/demo/m1/check.mdx', LESSON('m1')));
    const errors = checkContent(root);
    expect(errors).not.toEqual([]);
    expect(errors.join('\n')).toMatch(/check\.mdx: lesson slug "check" is reserved/);
  });

  it('reports a <CodeExercise> id that does not exist', () => {
    const root = variant((r) => edit(r, 'docs/demo/m1/intro.mdx', (s) => s + '\n<CodeExercise id="nope" />\n'));
    const errors = checkContent(root);
    expect(errors).not.toEqual([]);
    expect(errors.join('\n')).toMatch(/intro\.mdx: <CodeExercise id="nope"> does not exist/);
  });

  it('reports a lesson whose module does not exist', () => {
    const root = variant((r) => edit(r, 'docs/demo/m1/intro.mdx', (s) => s.replace('module: m1', 'module: ghost')));
    const errors = checkContent(root);
    expect(errors).not.toEqual([]);
    expect(errors.join('\n')).toMatch(/intro\.mdx: module "ghost" does not exist/);
  });
});

describe('check-content CLI', () => {
  const run = (root: string) => spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });

  it('exits 0 on the valid fixture', () => {
    const r = run(VALID);
    expect(r.status, r.stderr).toBe(0);
  });

  it('exits non-zero on an invalid fixture and names the problem', () => {
    const root = variant((r) => edit(r, 'quizzes/demo/m1/intro.yaml', (s) => s.replace('type: mcq', 'type: essay')));
    const r = run(root);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('essay');
  });
});

describe('checkContent reference integrity', () => {
  it('reports a duplicate module id', () => {
    const root = variant((r) => write(r, 'modules/m2.yaml', readFileSync(join(r, 'modules/m1.yaml'), 'utf8')));
    expect(checkContent(root).join('\n')).toMatch(/duplicate module id "m1"/);
  });
  it('reports a <Term> id that is not a glossary entry', () => {
    const root = variant((r) => edit(r, 'docs/demo/m1/intro.mdx', (s) => s.replace('id="widget"', 'id="gizmo"')));
    expect(checkContent(root).join('\n')).toMatch(/<Term id="gizmo"> is not a glossary entry/);
  });
  it('reports a goDeeper that is not a resource', () => {
    const root = variant((r) => edit(r, 'docs/demo/m1/intro.mdx', (s) => s.replace('goDeeper: some-resource', 'goDeeper: nowhere')));
    expect(checkContent(root).join('\n')).toMatch(/goDeeper "nowhere" is not a resource/);
  });
  it('reports a capstone whose homework is not kind capstone', () => {
    const root = variant((r) => edit(r, 'homework/demo-capstone.yaml', (s) => s.replace('kind: capstone', 'kind: homework')));
    expect(checkContent(root).join('\n')).toMatch(/expected "capstone"/);
  });
  it('reports a capstone homework that belongs to another module', () => {
    const root = variant((r) => edit(r, 'homework/demo-capstone.yaml', (s) => s.replace(/module: m1/, 'module: m0')));
    expect(checkContent(root).join('\n')).toMatch(/belongs to module "m0", expected "m1"/);
  });
  it('reports two lessons with the same order in one module', () => {
    const root = variant((r) => {
      const intro = readFileSync(join(r, 'docs/demo/m1/intro.mdx'), 'utf8');
      write(r, 'docs/demo/m1/other.mdx', intro.replace(/goDeeper:.*\n/, ''));
    });
    expect(checkContent(root).join('\n')).toMatch(/lesson order \d+ duplicates/);
  });
});

describe('real course content', () => {
  const ROOT = new URL('../../src/content', import.meta.url).pathname;
  const mods = new Map<string, string[]>();
  for (const f of readdirSync(join(ROOT, 'modules'))) {
    const y = readFileSync(join(ROOT, 'modules', f), 'utf8');
    mods.set(y.match(/^id: (\S+)/m)![1], JSON.parse(y.match(/^prereqs: (.*)$/m)![1]));
  }
  const closure = (id: string, acc = new Set<string>()) => {
    for (const p of mods.get(id) ?? []) if (!acc.has(p)) { acc.add(p); closure(p, acc); }
    return acc;
  };
  const foundations = [...mods.keys()].filter((k) => /^f\d+$/.test(k)).sort();
  it('track C needs exactly F0–F4, F6, F9, F10 (C10 adds F5)', () => {
    const f = (id: string) => [...closure(id)].filter((k) => k.startsWith('f')).sort();
    expect(f('c1')).toEqual(['f0', 'f1', 'f10', 'f2', 'f3', 'f4', 'f6', 'f9']);
    expect(f('c10')).toEqual(['f0', 'f1', 'f10', 'f2', 'f3', 'f4', 'f5', 'f6', 'f9']);
  });
  it('tracks A and B need all of Foundations; B also starts from B0', () => {
    for (const id of ['a1', 'b0']) expect([...closure(id)].filter((k) => k.startsWith('f')).sort()).toEqual(foundations);
    expect(closure('b1').has('b0')).toBe(true);
  });
});

describe('quiz values must be text', () => {
  it('reports an option whose text YAML parsed as a number', () => {
    const root = variant((r) => write(r, 'quizzes/demo/m1/intro.yaml', 'items:\n  - id: m1-intro-01\n    type: mcq\n    prompt: p\n    explanation: e\n    options:\n      - text: 0.5\n        correct: true\n        why: w\n      - text: "1"\n        why: w\n'));
    expect(checkContent(root).join('\n')).toMatch(/options\[0\]\.text must be text/);
  });
});
