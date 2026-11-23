import { STORAGE_KEY } from '@/lib/progress';

export default function Debug({ build }: { build: string }) {
  const raw = localStorage.getItem(STORAGE_KEY) ?? '(empty)';
  let pretty = raw;
  try {
    const s = JSON.parse(raw);
    if (s?.settings?.tutor?.apiKey) s.settings.tutor.apiKey = '••••';
    pretty = JSON.stringify(s, null, 2);
  } catch {}
  return (
    <dl className="air-debug not-content">
      <dt>Origin</dt><dd><code>{location.origin}</code></dd>
      <dt>Build</dt><dd><code>{build}</code></dd>
      <dt>Storage key</dt><dd><code>{STORAGE_KEY}</code> ({raw.length.toLocaleString()} bytes)</dd>
      <dt>Raw state</dt><dd><pre>{pretty}</pre></dd>
    </dl>
  );
}
