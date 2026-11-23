import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('../../scripts/check-notebooks.mjs', import.meta.url).pathname;
const load = async () => (await import(SCRIPT)).checkNotebooks as (dir: string) => string[];

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const GOOD = () => ({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Homework\n', 'Do the thing.'] },
    { cell_type: 'code', metadata: {}, source: 'print(1)', outputs: [], execution_count: null },
    { cell_type: 'code', metadata: {}, source: ['x = 2\n', 'x'], outputs: [], execution_count: 3 },
    { cell_type: 'raw', metadata: {}, source: '' },
  ],
});
type Nb = ReturnType<typeof GOOD> & Record<string, any>;

// Write notebooks (objects are JSON-encoded, strings written verbatim) into a fresh temp dir.
function dirWith(files: Record<string, object | string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-notebooks-'));
  temps.push(dir);
  for (const [name, nb] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof nb === 'string' ? nb : JSON.stringify(nb, null, 1));
  }
  return dir;
}
const mutated = (fn: (nb: Nb) => void) => {
  const nb = GOOD() as Nb;
  fn(nb);
  return nb;
};
const errorsFor = async (nb: object | string, name = 'hw.ipynb') => (await load())(dirWith({ [name]: nb }));

describe('checkNotebooks', () => {
  it('returns no errors for a valid notebook', async () => {
    expect(await errorsFor(GOOD())).toEqual([]);
  });

  it('returns no errors for an empty directory', async () => {
    expect((await load())(dirWith({}))).toEqual([]);
  });

  it('returns no errors when the directory does not exist', async () => {
    expect((await load())(join(tmpdir(), 'check-notebooks-does-not-exist-xyz'))).toEqual([]);
  });

  it('accepts a notebook with zero cells', async () => {
    expect(await errorsFor(mutated((nb) => (nb.cells = [])))).toEqual([]);
  });

  it('ignores non-.ipynb files', async () => {
    expect((await load())(dirWith({ 'README.md': 'not json {', 'ok.ipynb': GOOD() }))).toEqual([]);
  });

  it('reports invalid JSON and names the file', async () => {
    const errors = await errorsFor('{ "nbformat": 4, ', 'broken.ipynb');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain('broken.ipynb');
  });

  it('reports an empty file', async () => {
    const errors = await errorsFor('', 'empty.ipynb');
    expect(errors.join('\n')).toContain('empty.ipynb');
  });

  it('reports nbformat other than 4', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb as any).nbformat = 3)), 'old.ipynb');
    expect(errors.join('\n')).toMatch(/old\.ipynb.*nbformat/);
  });

  it('reports a missing nbformat', async () => {
    const errors = await errorsFor(mutated((nb) => delete (nb as any).nbformat), 'nofmt.ipynb');
    expect(errors.join('\n')).toMatch(/nofmt\.ipynb.*nbformat/);
  });

  it('reports a non-integer nbformat_minor', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb as any).nbformat_minor = 4.5)), 'minor.ipynb');
    expect(errors.join('\n')).toMatch(/minor\.ipynb.*nbformat_minor/);
  });

  it('reports a string nbformat_minor', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb as any).nbformat_minor = '5')), 'minor.ipynb');
    expect(errors.join('\n')).toMatch(/minor\.ipynb.*nbformat_minor/);
  });

  it('reports missing cells', async () => {
    const errors = await errorsFor(mutated((nb) => delete (nb as any).cells), 'nocells.ipynb');
    expect(errors.join('\n')).toMatch(/nocells\.ipynb.*cells/);
  });

  it('reports cells that is not an array', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb as any).cells = {})), 'cellsobj.ipynb');
    expect(errors.join('\n')).toMatch(/cellsobj\.ipynb.*cells/);
  });

  it('reports a missing metadata object', async () => {
    const errors = await errorsFor(mutated((nb) => delete (nb as any).metadata), 'nometa.ipynb');
    expect(errors.join('\n')).toMatch(/nometa\.ipynb.*metadata/);
  });

  it('reports metadata that is not an object', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb as any).metadata = 'x')), 'meta.ipynb');
    expect(errors.join('\n')).toMatch(/meta\.ipynb.*metadata/);
  });

  it('reports an unknown cell_type', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb.cells[0] as any).cell_type = 'heading')), 'ct.ipynb');
    expect(errors.join('\n')).toMatch(/ct\.ipynb.*(cell_type|heading)/);
  });

  it('reports a cell with no source', async () => {
    const errors = await errorsFor(mutated((nb) => delete (nb.cells[0] as any).source), 'src.ipynb');
    expect(errors.join('\n')).toMatch(/src\.ipynb.*source/);
  });

  it('reports a source array containing a non-string', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb.cells[0] as any).source = ['ok', 42])), 'src.ipynb');
    expect(errors.join('\n')).toMatch(/src\.ipynb.*source/);
  });

  it('reports a code cell without outputs', async () => {
    const errors = await errorsFor(mutated((nb) => delete (nb.cells[1] as any).outputs), 'out.ipynb');
    expect(errors.join('\n')).toMatch(/out\.ipynb.*outputs/);
  });

  it('reports a code cell whose outputs is not an array', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb.cells[1] as any).outputs = null)), 'out.ipynb');
    expect(errors.join('\n')).toMatch(/out\.ipynb.*outputs/);
  });

  it('reports a code cell with a string execution_count', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb.cells[1] as any).execution_count = '1')), 'ec.ipynb');
    expect(errors.join('\n')).toMatch(/ec\.ipynb.*execution_count/);
  });

  it('reports a code cell with a fractional execution_count', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb.cells[1] as any).execution_count = 1.5)), 'ec.ipynb');
    expect(errors.join('\n')).toMatch(/ec\.ipynb.*execution_count/);
  });

  it('reports a code cell missing execution_count', async () => {
    const errors = await errorsFor(mutated((nb) => delete (nb.cells[1] as any).execution_count), 'ec.ipynb');
    expect(errors.join('\n')).toMatch(/ec\.ipynb.*execution_count/);
  });

  it('reports only the bad notebook when several are present', async () => {
    const dir = dirWith({ 'good.ipynb': GOOD(), 'bad.ipynb': mutated((nb) => ((nb as any).nbformat = 3)) });
    const text = (await load())(dir).join('\n');
    expect(text).toContain('bad.ipynb');
    expect(text).not.toContain('good.ipynb');
  });

  it('handles file names with spaces and unicode', async () => {
    const errors = await errorsFor(mutated((nb) => ((nb as any).nbformat = 3)), 'week 1 – é.ipynb');
    expect(errors.join('\n')).toContain('week 1 – é.ipynb');
  });
});

describe('check-notebooks CLI', () => {
  const run = (dir: string) => spawnSync(process.execPath, [SCRIPT, '--dir', dir], { encoding: 'utf8' });

  it('exits 0 for a directory of valid notebooks', () => {
    const r = run(dirWith({ 'hw.ipynb': GOOD() }));
    expect(r.status, r.stderr).toBe(0);
  });

  it('exits 0 when the directory does not exist', () => {
    const r = run(join(tmpdir(), 'check-notebooks-does-not-exist-xyz'));
    expect(r.status, r.stderr).toBe(0);
  });

  it('exits non-zero and names the file for an invalid notebook', () => {
    const r = run(dirWith({ 'cli-bad.ipynb': 'not json' }));
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('cli-bad.ipynb');
  });
});
