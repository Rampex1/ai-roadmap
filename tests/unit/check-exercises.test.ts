import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';

const SCRIPT = new URL('../../scripts/check-exercises.mjs', import.meta.url).pathname;
const WASM = new URL('../../public/pyodide/pyodide.asm.wasm', import.meta.url).pathname;
const HAS_PYODIDE = existsSync(WASM);
const TIMEOUT = 120_000;

if (!HAS_PYODIDE) console.warn(`check-exercises: skipping Pyodide tests, ${WASM} not found`);

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const GOOD = {
  id: 'demo-add',
  lesson: 'demo/m1/intro',
  title: 'Add two numbers',
  prompt: 'Write `add(a, b)`.',
  starter: 'def add(a, b):\n    pass\n',
  solution: 'def add(a, b):\n    return a + b\n',
  tests: 'assert add(2, 3) == 5\n',
  hints: ['Use the + operator.'],
};

function dirWith(...exercises: Record<string, unknown>[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-exercises-'));
  temps.push(dir);
  for (const ex of exercises) writeFileSync(join(dir, `${ex.id}.yaml`), stringify(ex));
  return dir;
}

const load = async () => (await import(SCRIPT)).checkExercises as (dir: string) => Promise<string[]>;

describe('checkExercises', () => {
  it('exports a checkExercises function', async () => {
    expect(typeof (await load())).toBe('function');
  });

  describe.skipIf(!HAS_PYODIDE)('with Pyodide', () => {
    it('returns no errors for an exercise whose solution passes and starter fails', async () => {
      const checkExercises = await load();
      expect(await checkExercises(dirWith(GOOD))).toEqual([]);
    }, TIMEOUT);

    it('reports a solution that fails its tests, naming the exercise id', async () => {
      const checkExercises = await load();
      const errors = await checkExercises(dirWith({ ...GOOD, id: 'demo-bad-sol', solution: 'def add(a, b):\n    return a - b\n' }));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/demo-bad-sol/);
      expect(errors[0]).toMatch(/solution fails/);
    }, TIMEOUT);

    it('reports a starter that already passes its tests, naming the exercise id', async () => {
      const checkExercises = await load();
      const errors = await checkExercises(dirWith({ ...GOOD, id: 'demo-easy', starter: GOOD.solution }));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/demo-easy/);
      expect(errors[0]).toMatch(/starter passes/);
    }, TIMEOUT);

    it('reports a solution that raises a non-assertion error', async () => {
      const checkExercises = await load();
      const errors = await checkExercises(dirWith({ ...GOOD, id: 'demo-crash', solution: 'def add(a, b):\n    return undefined_name\n' }));
      expect(errors.join('\n')).toMatch(/demo-crash.*solution fails/);
    }, TIMEOUT);

    it('runs each exercise in a fresh namespace (no leakage between exercises)', async () => {
      const checkExercises = await load();
      // "a-good" defines add correctly; "b-nodef" has a starter/solution that never defines add.
      // If namespaces leaked, b's solution would pass using a's add.
      const errors = await checkExercises(
        dirWith({ ...GOOD, id: 'a-good' }, { ...GOOD, id: 'b-nodef', starter: 'x = 1\n', solution: 'y = 2\n' }),
      );
      expect(errors.join('\n')).toMatch(/b-nodef.*solution fails/);
      expect(errors.join('\n')).not.toMatch(/a-good/);
    }, TIMEOUT);

    it('reports every broken exercise in one run', async () => {
      const checkExercises = await load();
      const errors = await checkExercises(
        dirWith(GOOD, { ...GOOD, id: 'bad-1', solution: 'def add(a, b):\n    return 0\n' }, { ...GOOD, id: 'bad-2', starter: GOOD.solution }),
      );
      const text = errors.join('\n');
      expect(text).toMatch(/bad-1.*solution fails/);
      expect(text).toMatch(/bad-2.*starter passes/);
      expect(text).not.toMatch(/demo-add/);
    }, TIMEOUT);

    it('CLI exits 0 for a good directory and non-zero for a bad one', () => {
      const ok = spawnSync(process.execPath, [SCRIPT, '--dir', dirWith(GOOD)], { encoding: 'utf8' });
      expect(ok.status, ok.stderr).toBe(0);
      const bad = spawnSync(process.execPath, [SCRIPT, '--dir', dirWith({ ...GOOD, id: 'cli-bad', starter: GOOD.solution })], {
        encoding: 'utf8',
      });
      expect(bad.status).not.toBe(0);
      expect(bad.stdout + bad.stderr).toMatch(/cli-bad.*starter passes/);
    }, TIMEOUT);
  });
});
