import { askTutor } from '@/lib/ask-tutor';
import { courseOf } from '@/lib/sidebar';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { tags as t } from '@lezer/highlight';
import { recordExercise } from '@/lib/progress';
import type { FromWorker } from '@/workers/pyodide.worker';
import { useProgress } from './useProgress';
import { saveErrorText } from './saveError';

type Status = 'passed' | 'failed' | 'error' | 'stopped';
interface Result { status: Status; message: string; figures: string[]; unavailable?: boolean }
interface Handlers { onStatus(text: string): void; onOutput(stream: 'stdout' | 'stderr', text: string): void }

const TIME_LIMIT_MS = 10_000;

// ---------- One shared Pyodide worker per page (design §5.5) ----------
let worker: Worker | null = null;
let loaded = false;
let seq = 0;
let active: { id: number; h: Handlers; resolve: (r: Result) => void; timer?: ReturnType<typeof setTimeout> } | null = null;
const busySubs = new Set<() => void>();
const subscribeBusy = (cb: () => void) => (busySubs.add(cb), () => void busySubs.delete(cb));
const isBusy = () => active !== null;

function warmUp() {
  if (worker) return;
  loaded = false;
  const w = new Worker(new URL('../../workers/pyodide.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<FromWorker>) => {
    if (w !== worker) return; // a terminated worker's queued messages must not affect its replacement
    const m = e.data;
    if (m.type === 'loaded') {
      loaded = true;
      console.info(`[code runner] Python ready in ${m.ms} ms`);
      return;
    }
    if (m.type === 'fatal') return unavailable(m.message);
    if (!active || m.id !== active.id) return;
    if (m.type === 'status') active.h.onStatus(m.text);
    else if (m.type === 'output') active.h.onOutput(m.stream, m.text);
    else if (m.type === 'ready-to-run') {
      active.h.onStatus('Running…');
      active.timer = setTimeout(() => stop(`Stopped after ${TIME_LIMIT_MS / 1000} s time limit`), TIME_LIMIT_MS);
    } else if (m.type === 'result') finish({ status: m.status, message: m.message, figures: m.figures });
  };
  w.onerror = (e) => unavailable(e.message || 'the worker failed to start');
  worker = w;
}

function kill() {
  worker?.terminate();
  worker = null;
}

function finish(r: Result) {
  const a = active;
  if (!a) return;
  clearTimeout(a.timer);
  active = null;
  a.resolve(r);
  busySubs.forEach((cb) => cb());
}

// Load failure: drop the worker so the next Run retries from scratch (no automatic retry loop).
function unavailable(reason: string) {
  kill();
  finish({ status: 'error', message: `Python runtime unavailable (${reason}). The rest of the lesson still works; press Run to retry.`, figures: [], unavailable: true });
}

/** Stop button or watchdog: terminate (the only way to interrupt without COOP/COEP) and start a fresh worker. */
function stop(message = 'Stopped') {
  if (!active) return;
  kill();
  finish({ status: 'stopped', message, figures: [] });
  warmUp();
}

function runPython(code: string, tests: string, h: Handlers): Promise<Result> {
  warmUp();
  if (!loaded) h.onStatus('Loading Python…');
  const id = ++seq;
  const p = new Promise<Result>((resolve) => (active = { id, h, resolve }));
  busySubs.forEach((cb) => cb());
  worker!.postMessage({ type: 'run', id, code, tests });
  return p;
}

// ---------- Editor ----------
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--air-code-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--air-code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--air-code-number)' },
  { tag: t.comment, color: 'var(--air-code-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.definition(t.variableName)), t.definition(t.className), t.function(t.variableName)], color: 'var(--air-code-function)' },
  { tag: [t.self, t.standard(t.variableName)], color: 'var(--air-code-builtin)' },
]);

const draftKey = (id: string) => `airoadmap:draft:${id}`;
const readDraft = (id: string) => {
  try {
    return localStorage.getItem(draftKey(id));
  } catch {
    return null;
  }
};
const writeDraft = (id: string, code: string, starter: string) => {
  try {
    if (code === starter) localStorage.removeItem(draftKey(id));
    else localStorage.setItem(draftKey(id), code);
  } catch {}
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const STATUS_TEXT: Record<Exclude<Status, 'stopped'>, string> = {
  passed: 'Passed — all tests pass.',
  failed: 'Not yet — a test failed.',
  error: 'Your code raised an error.',
};

interface Props { id: string; title: string; starter: string; tests: string; hintsHtml: string[] }

export default function CodeExerciseIsland({ id, title, starter, tests, hintsHtml }: Props) {
  const [state, store] = useProgress();
  const busy = useSyncExternalStore(subscribeBusy, isBusy, () => false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [output, setOutput] = useState<{ stream: 'stdout' | 'stderr'; text: string }[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [hints, setHints] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const runRef = useRef<() => void>(() => {});
  const labelId = useId();
  const helpId = useId();
  const passedBefore = state.exercises[id]?.passed === true;

  const run = async () => {
    if (isBusy() || !view.current) return;
    const code = view.current.state.doc.toString();
    setRunning(true);
    setResult(null);
    setSaveError(null);
    setOutput([]);
    setAnnounce('Running your code…');
    const r = await runPython(code, tests, {
      onStatus: setStatus,
      onOutput: (stream, text) =>
        setOutput((o) => (o.at(-1)?.stream === stream ? [...o.slice(0, -1), { stream, text: o.at(-1)!.text + '\n' + text }] : [...o, { stream, text }])),
    });
    setRunning(false);
    setStatus('');
    setResult(r);
    setAnnounce(r.status === 'passed' ? STATUS_TEXT.passed : r.status === 'stopped' ? `${r.message}.` : `${STATUS_TEXT[r.status]} ${r.message.split('\n').at(-1)}`);
    // Pass is sticky (recordExercise); a stop or a broken runtime is not an attempt.
    if (r.status !== 'stopped' && !r.unavailable)
      setSaveError(saveErrorText(store.update((s) => {
        const next = recordExercise(s, id, r.status === 'passed', new Date());
        const course = courseOf(location.pathname);
        return course ? { ...next, settings: { ...next.settings, lastCourse: course } } : next;
      })));
  };
  runRef.current = run;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: readDraft(id) ?? starter,
        extensions: [
          Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => (runRef.current(), true) }])),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          python(),
          syntaxHighlighting(highlight),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorState.tabSize.of(4),
          EditorView.contentAttributes.of({ 'aria-labelledby': labelId, 'aria-describedby': helpId }),
          EditorView.updateListener.of((u) => u.docChanged && writeDraft(id, u.state.doc.toString(), starter)),
        ],
      }),
    });
    view.current = v;
    // Start Python in the background once the exercise has been on screen for a moment
    // (not when merely scrolled past), so it is usually ready by the first Run.
    let dwell: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver((es) => {
      clearTimeout(dwell);
      if (es.at(-1)!.isIntersecting) dwell = setTimeout(() => (warmUp(), io.disconnect()), 1000);
    });
    io.observe(root.current!);
    return () => {
      clearTimeout(dwell);
      io.disconnect();
      v.destroy();
    };
  }, [id, starter, labelId, helpId]);

  const reset = () => {
    const v = view.current;
    if (!v) return;
    const code = v.state.doc.toString();
    if (code === starter) return;
    if (!confirm('Replace your code with the starter code? Your changes will be lost.')) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: starter } });
    v.focus();
  };

  const showOutput = running || output.length > 0 || (result?.figures.length ?? 0) > 0;
  return (
    <div className="air-ex-body" ref={root}>
      <div className="air-ex-toolbar">
        <span className="air-ex-label" id={labelId}>
          Python editor<span className="sr-only">: {title}</span>
        </span>
        {passedBefore && (
          <span className="air-pill air-ex-passed-pill" title="You have passed this exercise before">
            ✓ Passed
          </span>
        )}
      </div>
      <div className="air-ex-editor" ref={host} />
      <p className="air-ex-help" id={helpId}>
        {isMac ? '⌘' : 'Ctrl'}+Enter runs your code. Tab indents; press Esc, then Tab, to leave the editor.
      </p>

      <div className="air-row air-ex-actions">
        <button type="button" className="air-btn air-btn-primary" onClick={run} disabled={busy}>
          {running ? 'Running…' : 'Run'}
        </button>
        <button type="button" className="air-btn" onClick={() => stop()} disabled={!running}>
          Stop
        </button>
        <button type="button" className="air-btn" onClick={reset} disabled={running}>
          Reset
        </button>
        {hintsHtml.length > 0 && (
          <button type="button" className="air-btn air-ex-hint-btn" onClick={() => setHints((n) => n + 1)} disabled={hints >= hintsHtml.length}>
            {hints === 0 ? 'Hint' : hints < hintsHtml.length ? `Next hint (${hints + 1} of ${hintsHtml.length})` : 'No more hints'}
          </button>
        )}
      </div>

      {hints > 0 && (
        <ol className="air-ex-hints" aria-label="Hints">
          {hintsHtml.slice(0, hints).map((h, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: h }} />
          ))}
        </ol>
      )}

      {status && (
        <p className="air-ex-status">
          <span className="air-ex-spinner" aria-hidden="true" />
          {status}
        </p>
      )}

      {showOutput && (
        <div className="air-ex-output" data-output role="region" aria-label="Output">
          {output.length > 0 ? (
            <pre>
              {output.map((o, i) => (
                <span key={i} className={o.stream === 'stderr' ? 'air-ex-stderr' : undefined}>
                  {o.text + '\n'}
                </span>
              ))}
            </pre>
          ) : (
            running && <p className="air-ex-empty">No output yet.</p>
          )}
          {result?.figures.map((f, i) => (
            <img key={i} data-figure src={`data:image/png;base64,${f}`} alt={`Figure ${i + 1} drawn by your code`} />
          ))}
        </div>
      )}

      {result && (
        <div className={`air-ex-result air-ex-${result.status}`} data-result data-status={result.status}>
          <p className="air-ex-result-head">{result.status === 'stopped' ? `${result.message}.` : STATUS_TEXT[result.status]}</p>
          {(result.status === 'failed' || result.status === 'error') && <pre className="air-ex-message">{result.message}</pre>}
          {(result.status === 'failed' || result.status === 'error') && (
            <button type="button" className="air-btn air-btn-ghost" onClick={() => askTutor({ error: `${result.message.slice(0, 2000)}\n\nTheir code:\n${(view.current?.state.doc.toString() ?? '').slice(0, 3000)}`, prompt: 'My code does not pass yet. Can you give me a hint (not the full answer)?' })}>
              Explain this with the tutor
            </button>
          )}
          {saveError && <p className="air-ex-save-error">{saveError}</p>}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  );
}
