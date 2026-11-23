/// <reference lib="webworker" />
// One Pyodide per page (design §5.5). Loads the vendored runtime from /pyodide/, then for each run:
// install imported packages → post ready-to-run (the 10 s watchdog starts here) → run code + tests.
import type { PyodideInterface } from 'pyodide';
import HARNESS from './runner.py?raw';

export type ToWorker = { type: 'run'; id: number; code: string; tests: string };
export type FromWorker =
  | { type: 'loaded'; ms: number }
  | { type: 'fatal'; message: string }
  | { type: 'status'; id: number; text: string }
  | { type: 'ready-to-run'; id: number }
  | { type: 'output'; id: number; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'result'; id: number; status: 'passed' | 'failed' | 'error'; message: string; figures: string[] };

const post = (m: FromWorker) => self.postMessage(m);
const INDEX = '/pyodide/';
let current = 0; // id of the run whose output is being streamed
const OUTPUT_CAP = 20_000; // chars per run; a print loop must not flood the page
let sent = 0;
const emit = (stream: 'stdout' | 'stderr') => (text: string) => {
  if (sent >= OUTPUT_CAP) return;
  const room = OUTPUT_CAP - sent;
  sent += text.length;
  post({ type: 'output', id: current, stream, text: text.length > room ? `${text.slice(0, room)}\n… output truncated` : text });
};

const started = performance.now();
const ready = (async () => {
  const { loadPyodide } = await import(/* @vite-ignore */ `${INDEX}pyodide.mjs`);
  const py: PyodideInterface = await loadPyodide({ indexURL: INDEX, env: { MPLBACKEND: 'AGG' } });
  py.setStdout({ batched: emit('stdout') });
  py.setStderr({ batched: emit('stderr') });
  py.runPython(HARNESS);
  const run: (code: string, tests: string) => string = py.globals.get('run');
  const preimport: (source: string) => void = py.globals.get('preimport');
  post({ type: 'loaded', ms: Math.round(performance.now() - started) });
  return { py, run, preimport };
})();
ready.catch((e) => post({ type: 'fatal', message: String(e?.message ?? e) }));

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const { id, code, tests } = e.data;
  current = id;
  sent = 0;
  const { py, run, preimport } = await ready;
  try {
    await py.loadPackagesFromImports(`${code}\n${tests}`, {
      messageCallback: (text: string) => post({ type: 'status', id, text }),
      errorCallback: (text: string) => post({ type: 'output', id, stream: 'stderr', text }),
    });
  } catch (err: any) {
    // A missing or broken wheel: report it, and let the learner's import raise ModuleNotFoundError.
    post({ type: 'output', id, stream: 'stderr', text: `Could not install packages: ${err?.message ?? err}` });
  }
  preimport(`${code}\n${tests}`);
  post({ type: 'ready-to-run', id });
  try {
    post({ type: 'result', id, ...JSON.parse(run(code, tests)) });
  } catch (err: any) {
    // Pyodide itself failed (e.g. out of memory): report it instead of waiting for the watchdog.
    post({ type: 'result', id, status: 'error', message: `The Python runtime crashed: ${err?.message ?? err}`, figures: [] });
  }
};
