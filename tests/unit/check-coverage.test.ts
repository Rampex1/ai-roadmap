import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('../../scripts/check-coverage.mjs', import.meta.url).pathname;
const load = async () => (await import(SCRIPT)).checkCoverage as (root: string, o?: { strict?: boolean; publicDir?: string }) => string[];
const temps: string[] = [];
afterEach(() => temps.splice(0).forEach((t) => rmSync(t, { recursive: true, force: true })));

const items = (n: number) => 'items:\n' + Array.from({ length: n }, (_, i) => `  - id: q${i}\n    type: cloze\n    prompt: p\n    explanation: e\n    accept: [a]\n`).join('');

/** content root with module m1 (one lesson, 8 items, homework + notebook) and module m2 (no lessons, capstone c). */
function fixture(mut?: (root: string, pub: string) => void) {
  const base = mkdtempSync(join(tmpdir(), 'cov-'));
  temps.push(base);
  const root = join(base, 'content');
  const pub = join(base, 'public');
  const w = (p: string, s: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, s); };
  w(join(root, 'modules/m1.yaml'), 'id: m1\ncourse: demo\ntitle: M1\norder: 1\nprereqs: []\nobjectives: [x]\n');
  w(join(root, 'modules/m2.yaml'), 'id: m2\ncourse: demo\ntitle: M2\norder: 2\nprereqs: [m1]\nobjectives: [x]\ncapstone: cap\n');
  w(join(root, 'docs/demo/m1/intro.mdx'), '---\ntitle: Intro\nmodule: m1\norder: 1\nestMinutes: 10\nobjectives: [x]\n---\nHi\n');
  w(join(root, 'quizzes/demo/m1/intro.yaml'), items(8));
  w(join(root, 'homework/m1-hw.yaml'), 'id: m1-hw\nmodule: m1\nkind: homework\ntitle: HW\nbrief: Do it.\nnotebook: /homework/m1-hw.ipynb\nrubric: [a]\ncompute: laptop\n');
  w(join(pub, 'homework/m1-hw.ipynb'), '{}');
  w(join(root, 'homework/cap.yaml'), 'id: cap\nmodule: m2\nkind: capstone\ntitle: Cap\nbrief: "Placeholder brief."\nnotebook: /homework/cap.ipynb\nrubric: [a]\ncompute: laptop\n');
  mut?.(root, pub);
  return { root, pub };
}

describe('checkCoverage', () => {
  it('passes a module with enough quiz items and a homework notebook; ignores empty modules when not strict', async () => {
    const { root, pub } = fixture();
    expect(await (await load())(root, { publicDir: pub })).toEqual([]);
  });
  it('reports a lesson with fewer than 8 quiz items', async () => {
    const { root, pub } = fixture((r) => writeFileSync(join(r, 'quizzes/demo/m1/intro.yaml'), items(7)));
    expect((await load())(root, { publicDir: pub }).join('\n')).toMatch(/demo\/m1\/intro.*7 quiz items/);
  });
  it('reports a module whose homework notebook is missing', async () => {
    const { root, pub } = fixture((_r, p) => rmSync(join(p, 'homework/m1-hw.ipynb')));
    expect((await load())(root, { publicDir: pub }).join('\n')).toMatch(/m1.*notebook/);
  });
  it('reports a module with lessons but no homework', async () => {
    const { root, pub } = fixture((r) => rmSync(join(r, 'homework/m1-hw.yaml')));
    expect((await load())(root, { publicDir: pub }).join('\n')).toMatch(/m1.*no homework/);
  });
  it('strict mode reports a module with no lessons and a placeholder capstone', async () => {
    const { root, pub } = fixture();
    const out = (await load())(root, { publicDir: pub, strict: true }).join('\n');
    expect(out).toMatch(/m2.*no lessons/);
    expect(out).toMatch(/cap.*[Pp]laceholder/);
  });
  it('CLI exits non-zero in strict mode on the fixture and zero without it', () => {
    const { root, pub } = fixture();
    expect(spawnSync(process.execPath, [SCRIPT, '--root', root, '--public', pub]).status).toBe(0);
    expect(spawnSync(process.execPath, [SCRIPT, '--root', root, '--public', pub, '--strict']).status).not.toBe(0);
  });
});
