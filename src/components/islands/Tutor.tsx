import { useEffect, useRef, useState } from 'react';
import { buildSystemPrompt, friendlyError, streamChat, type Msg } from '@/lib/tutor';
import { ASK_EVENT, type AskDetail } from '@/lib/ask-tutor';
import { useProgress } from './useProgress';

const MAX_TURNS = 8;

export default function Tutor({ lessonTitle, objectives }: { lessonTitle: string; objectives: string[] }) {
  const [state] = useProgress();
  const cfg = state.settings.tutor;
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const [context, setContext] = useState<{ question?: string; error?: string }>({});
  const [history, setHistory] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const open = (fresh = true) => {
    if (fresh) setContext({}); // the plain button starts without stale quiz/exercise context
    dialog.current?.showModal();
    setTimeout(() => input.current?.focus(), 0);
  };

  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<AskDetail>).detail;
      setContext({ question: d.question, error: d.error });
      setDraft(d.prompt);
      open(false);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

  const send = async () => {
    if (!cfg || !draft.trim() || busy) return;
    const section = (document.querySelector('.sl-markdown-content') as HTMLElement | null)?.innerText ?? '';
    const system: Msg = { role: 'system', content: buildSystemPrompt({ lessonTitle, objectives, section, ...context }) };
    const user: Msg = { role: 'user', content: draft.trim() };
    const msgs = [system, ...history.slice(-MAX_TURNS), user]; // keep small models' context and free-tier tokens in check
    setHistory((h) => [...h, user]);
    setDraft('');
    setError(null);
    setBusy(true);
    setStreaming('');
    abort.current = new AbortController();
    let text = '';
    try {
      for await (const delta of streamChat({ baseURL: cfg.baseURL, model: cfg.model, apiKey: cfg.apiKey, messages: msgs, signal: abort.current.signal })) {
        text += delta;
        setStreaming(text);
      }
      setHistory((h) => [...h, { role: 'assistant', content: text }]);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError(friendlyError(e, cfg.provider, cfg.model));
      if (text) setHistory((h) => [...h, { role: 'assistant', content: text }]);
    } finally {
      setStreaming('');
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="air-btn air-tutor-open not-content" onClick={() => open()}>
        <span aria-hidden="true">✦</span> Ask the tutor
      </button>
      <dialog ref={dialog} className="air-tutor not-content" aria-labelledby="air-tutor-title" onClose={() => abort.current?.abort()}>
        <div className="air-tutor-head">
          <h2 id="air-tutor-title">AI tutor</h2>
          <button type="button" className="air-icon-btn" aria-label="Close tutor" onClick={() => dialog.current?.close()}>✕</button>
        </div>
        {!cfg ? (
          <div className="air-tutor-setup">
            <p>The tutor is optional and free. Pick a provider first: OpenRouter's free models are the easiest start; Ollama runs fully offline on your Mac.</p>
            <a className="air-btn air-btn-primary" href="/settings/">Set up the tutor in Settings</a>
          </div>
        ) : (
          <>
            <p className="air-tutor-meta">Using {cfg.provider} · {cfg.model}. It knows which lesson you're on; it hints before it solves.</p>
            <div className="air-tutor-log" aria-live="polite" aria-busy={busy} data-tutor-answer>
              {history.filter((m) => m.role !== 'system').map((m, i) => (
                <p key={i} className={`air-tutor-msg is-${m.role}`}>{m.content}</p>
              ))}
              {streaming && <p className="air-tutor-msg is-assistant">{streaming}</p>}
              {busy && !streaming && <p className="air-tutor-msg is-pending">Thinking…</p>}
              {error && <p role="alert" className="air-callout air-callout-error">{error}</p>}
            </div>
            <form className="air-tutor-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <label htmlFor="air-tutor-q">Your question</label>
              <textarea id="air-tutor-q" ref={input} className="air-text" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); }} />
              <div className="air-row">
                <button type="submit" className="air-btn air-btn-primary" disabled={busy || !draft.trim()}>Send</button>
                {busy && <button type="button" className="air-btn" onClick={() => abort.current?.abort()}>Stop</button>}
              </div>
            </form>
          </>
        )}
      </dialog>
    </>
  );
}
