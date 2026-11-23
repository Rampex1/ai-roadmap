import { useState } from 'react';
import { PRESETS } from '@/lib/tutor';
import { useProgress } from './useProgress';
import { saveErrorText } from './saveError';

export default function TutorSettings() {
  const [state, store] = useProgress();
  const cur = state.settings.tutor;
  const [provider, setProvider] = useState(cur?.provider ?? '');
  const [baseURL, setBaseURL] = useState(cur?.baseURL ?? '');
  const [model, setModel] = useState(cur?.model ?? '');
  const [apiKey, setApiKey] = useState(cur?.apiKey ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const preset = PRESETS.find((p) => p.id === provider);

  const choose = (id: string) => {
    if (id !== provider) setApiKey(''); // never send one provider's key to another host
    setProvider(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p) {
      setBaseURL(p.baseURL);
      setModel(p.model);
    }
  };
  const save = () => {
    if (provider) {
      let url: URL | null = null;
      try { url = new URL(baseURL.trim()); } catch {}
      const local = url && ['localhost', '127.0.0.1'].includes(url.hostname);
      if (!url || (url.protocol !== 'https:' && !local)) {
        setMsg({ ok: false, text: 'Base URL must be https:// (or http:// on localhost) so your key is never sent unencrypted.' });
        return;
      }
    }
    const r = store.update((s) => ({
      ...s,
      settings: { ...s.settings, tutor: provider ? { provider, baseURL: baseURL.trim(), model: model.trim(), apiKey: apiKey.trim() || undefined } : undefined },
    }));
    setMsg(r.ok ? { ok: true, text: provider ? 'Tutor settings saved.' : 'Tutor turned off.' } : { ok: false, text: saveErrorText(r)! });
  };

  return (
    <section className="air-card not-content" aria-labelledby="tutor-settings">
      <h2 id="tutor-settings">Tutor</h2>
      <p>Optional and free. Your key stays in this browser and is never included in exports.</p>
      <div className="air-form">
        <label htmlFor="tutor-provider">Provider</label>
        <select id="tutor-provider" className="air-text" value={provider} onChange={(e) => choose(e.target.value)}>
          <option value="">Off</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="custom">Custom</option>
        </select>
        {preset?.note && <p className="air-hint">{preset.note}</p>}
        {provider === 'custom' && <p className="air-hint">Any OpenAI-compatible endpoint, for example LM Studio or a local llama.cpp server.</p>}
            <label htmlFor="tutor-base">Base URL</label>
            <input id="tutor-base" className="air-text" type="url" disabled={!provider} value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
            <label htmlFor="tutor-model">Model</label>
            <input id="tutor-model" className="air-text" type="text" disabled={!provider} value={model} onChange={(e) => setModel(e.target.value)} />
            <label htmlFor="tutor-key">API key{preset && !preset.needsKey ? ' (not needed)' : ''}</label>
            <input id="tutor-key" className="air-text" type="password" disabled={!provider} autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <button type="button" className="air-btn air-btn-primary" onClick={save}>Save tutor settings</button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`air-callout air-callout-${msg.ok ? 'ok' : 'error'}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
