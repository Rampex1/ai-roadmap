import { useState } from 'react';
import { emptyState, exportState, mergeImport, parseImport } from '@/lib/progress';
import { useProgress } from './useProgress';
import { saveErrorText } from './saveError';

const today = () => new Date().toISOString().slice(0, 10);

export default function Settings() {
  const [state, store] = useProgress();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const doExport = () => {
    const now = new Date();
    const blob = new Blob([exportState(state, now)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `progress-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    const r = store.update((s) => ({ ...s, settings: { ...s.settings, lastExportAt: now.toISOString() } }));
    setMessage({ kind: 'ok', text: 'Progress exported.' + (r.ok ? '' : ` (${saveErrorText(r)})`) });
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const incoming = parseImport(await file.text());
      if (store.corrupt) store.resetCorrupt(); // importing a backup is the recovery path
      const result = store.update((s) => mergeImport(s, incoming));
      setMessage(result.ok ? { kind: 'ok', text: 'Progress imported and merged.' } : { kind: 'error', text: saveErrorText(result)! });
    } catch (e) {
      setMessage({ kind: 'error', text: `Could not import: ${(e as Error).message}` });
    }
  };

  const doReset = () => {
    if (!window.confirm('Reset all progress? Export a backup first if you might want it back.')) return;
    const r = store.corrupt ? store.resetCorrupt() : store.update((s) => ({ ...emptyState(), settings: { tutor: s.settings.tutor } }));
    setMessage(r.ok ? { kind: 'ok', text: 'Progress reset.' } : { kind: 'error', text: saveErrorText(r)! });
  };

  const last = state.settings.lastExportAt;
  return (
    <div className="air-settings not-content">
      {store.corrupt && (
        <p role="alert" className="air-callout air-callout-warn">
          Saved progress could not be read. A copy was kept in browser storage; import a backup below if you have one.
        </p>
      )}
      <section className="air-card">
        <h2>Backup</h2>
        <p>Progress lives in this browser only. Export it regularly; {last ? `last export ${new Date(last).toLocaleDateString()}` : 'you have never exported'}.</p>
        <div className="air-row">
          <button type="button" className="air-btn air-btn-primary" onClick={doExport}>Export progress</button>
          <label className="air-btn">
            Import progress
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; doImport(f); }} />
          </label>
        </div>
      </section>
      <section className="air-card">
        <h2>Reset</h2>
        <p>Remove all lessons, reviews and mastery records. Tutor settings are kept.</p>
        <button type="button" className="air-btn air-btn-danger" onClick={doReset}>Reset progress</button>
      </section>
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`air-callout air-callout-${message.kind}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
