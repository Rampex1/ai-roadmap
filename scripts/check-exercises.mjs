#!/usr/bin/env node
// Every exercise must be gradeable: its solution passes its tests and its starter does not.
// Runs the same Python harness as the browser worker, in Node, from the vendored public/pyodide
// (packages load from local files only, never the CDN).
// Usage: node scripts/check-exercises.mjs [--dir src/content/exercises]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { Worker } from 'node:worker_threads';

const TIME_LIMIT_MS = 10_000; // same limit as the browser watchdog

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PYODIDE = join(ROOT, 'public/pyodide/');
const HARNESS = readFileSync(join(ROOT, 'src/workers/runner.py'), 'utf8');

let pyodide;
let interrupt;
async function runtime() {
  if (pyodide) return pyodide;
  if (!existsSync(join(PYODIDE, 'pyodide.asm.wasm'))) throw new Error(`check-exercises: ${PYODIDE} is missing; run "node scripts/vendor-pyodide.mjs"`);
  const { loadPyodide } = await import(pathToFileURL(join(PYODIDE, 'pyodide.mjs')).href);
  pyodide = await loadPyodide({
    indexURL: PYODIDE,
    packageCacheDir: PYODIDE,
    lockFileURL: join(PYODIDE, 'pyodide-lock.json'),
    packageBaseUrl: PYODIDE,
    env: { MPLBACKEND: 'AGG' },
    stdout: () => {},
    stderr: () => {},
  });
  pyodide.setStdout({ batched: () => {} });
  pyodide.setStderr({ batched: () => {} });
  pyodide.runPython(HARNESS);
  // Interrupt runaway code the way the browser does: a timer thread raises KeyboardInterrupt.
  interrupt = new Uint8Array(new SharedArrayBuffer(1));
  pyodide.setInterruptBuffer(interrupt);
  return pyodide;
}

async function grade(code, tests) {
  const py = await runtime();
  await py.loadPackagesFromImports(`${code}\n${tests}`, { messageCallback: () => {}, errorCallback: () => {} });
  py.globals.get('preimport')(`${code}\n${tests}`); // imports don't count against the limit, as in the browser
  interrupt[0] = 0;
  const timer = new Worker(
    `const { workerData } = require('node:worker_threads');
     setTimeout(() => { new Uint8Array(workerData)[0] = 2; }, ${TIME_LIMIT_MS});`,
    { eval: true, workerData: interrupt.buffer },
  );
  const t0 = performance.now();
  try {
    const out = JSON.parse(py.globals.get('run')(code, tests));
    return { ...out, slow: performance.now() - t0 >= TIME_LIMIT_MS };
  } finally {
    await timer.terminate();
    interrupt[0] = 0;
  }
}

export async function checkExercises(dir) {
  const errors = [];
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  for (const f of files) {
    const ex = parse(readFileSync(join(dir, f), 'utf8'));
    const id = ex?.id ?? f;
    const sol = await grade(ex.solution ?? '', ex.tests ?? '');
    if (sol.slow) errors.push(`${id}: solution exceeds the ${TIME_LIMIT_MS / 1000} s time limit the browser enforces`);
    else if (sol.status !== 'passed') errors.push(`${id}: solution fails its tests (${sol.status}): ${sol.message.split('\n').at(-1)}`);
    const start = await grade(ex.starter ?? '', ex.tests ?? '');
    if (start.status === 'passed') errors.push(`${id}: starter passes its tests (it should fail until the learner solves it)`);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--dir');
  const dir = resolve(i > -1 ? process.argv[i + 1] : join(ROOT, 'src/content/exercises'));
  const errors = await checkExercises(dir);
  if (errors.length) {
    console.error(`check-exercises: ${errors.length} problem(s)\n` + errors.map((e) => `  ✗ ${e}`).join('\n'));
    process.exit(1);
  }
  console.log(`check-exercises: OK (${readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).length} exercises)`);
}
