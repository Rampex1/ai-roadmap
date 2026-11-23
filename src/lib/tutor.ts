// Optional $0 AI tutor: one OpenAI-compatible streaming client, several presets (design §5.5, D2).

export type Preset = { id: string; label: string; baseURL: string; model: string; needsKey: boolean; note?: string };

export const PRESETS: Preset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter (free models)',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    needsKey: true,
    note: 'Free models allow about 20 requests a minute and 50 a day. Create a key at openrouter.ai/keys.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local, private, offline)',
    baseURL: 'http://localhost:11434/v1',
    model: 'llama3.2:3b',
    needsKey: false,
    note: 'Install with `brew install ollama`, then run `ollama pull llama3.2:3b`. A 3B model fits in 8 GB of RAM.',
  },
  {
    id: 'groq',
    label: 'Groq (free tier)',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    needsKey: true,
    note: 'Free tier with per-day limits. Create a key at console.groq.com/keys.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini (free tier)',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    needsKey: true,
    note: 'Free tier: Google may use your prompts to improve its products, and humans may review them.',
  },
];

export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

const MAX_PROMPT = 12_000;

export function buildSystemPrompt(ctx: { lessonTitle: string; objectives: string[]; section?: string; question?: string; error?: string }): string {
  const head = [
    'You are a patient tutor in a self-paced AI course for a learner who started with no background.',
    'Teach; do not just answer. Give a hint or a guiding question first, and only give a full solution if the learner asks for it again.',
    'Keep answers short and use plain language. Write math in plain text (for example x^2, sum of x_i), not LaTeX, because your reply is shown as plain text.',
    '',
    `Current lesson: ${ctx.lessonTitle}`,
    'Lesson objectives:',
    ...ctx.objectives.map((o) => `- ${o}`),
  ];
  const tail: string[] = [];
  if (ctx.question) tail.push('', 'The learner is working on this quiz question:', ctx.question.slice(0, 2000));
  if (ctx.error) tail.push('', 'Their code produced this error:', ctx.error.slice(0, 5000));
  const fixed = [...head, ...tail].join('\n');
  if (!ctx.section) return fixed.slice(0, MAX_PROMPT);
  const room = Math.max(0, MAX_PROMPT - fixed.length - 40);
  return [...head, '', 'Lesson text (may be truncated):', ctx.section.slice(0, room), ...tail].join('\n');
}

export function parseSSE(chunk: string): { deltas: string[]; done: boolean; rest: string; error?: string } {
  const lines = chunk.split(/\r?\n/);
  const rest = lines.pop() ?? ''; // possibly incomplete
  const deltas: string[] = [];
  let done = false;
  let error: string | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue; // blank lines, ": keep-alive" comments, event: lines
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      done = true;
      break;
    }
    try {
      const json = JSON.parse(data);
      if (json?.error) {
        error = String(json.error.message ?? json.error.code ?? 'error');
        break;
      }
      const content = json?.choices?.[0]?.delta?.content;
      if (typeof content === 'string' && content) deltas.push(content);
    } catch {
      // ignore malformed lines
    }
  }
  return error ? { deltas, done, rest, error } : { deltas, done, rest };
}

export class TutorError extends Error {
  constructor(
    public kind: 'rate-limit' | 'auth' | 'unreachable' | 'not-found' | 'bad-response',
    message: string,
  ) {
    super(message);
    this.name = 'TutorError';
  }
}

export async function* streamChat(opts: {
  baseURL: string;
  model: string;
  apiKey?: string;
  messages: Msg[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): AsyncGenerator<string> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${opts.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}) },
      body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new TutorError('unreachable', String((e as Error)?.message ?? e));
  }
  if (!res.ok) {
    const kind = res.status === 429 ? 'rate-limit' : res.status === 401 || res.status === 403 ? 'auth' : res.status === 404 ? 'not-found' : 'bad-response';
    throw new TutorError(kind, `HTTP ${res.status}`);
  }
  if (!res.body) throw new TutorError('bad-response', 'empty response');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let any = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buf += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const parsed = parseSSE(done ? buf + '\n' : buf);
      buf = parsed.rest;
      if (parsed.deltas.length) any = true;
      yield* parsed.deltas;
      if (parsed.error) throw new TutorError(/rate/i.test(parsed.error) ? 'rate-limit' : 'bad-response', parsed.error);
      if (parsed.done || done) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!any) throw new TutorError('bad-response', 'the provider sent an empty reply');
}

export function friendlyError(e: unknown, provider: string, model?: string): string {
  const kind = e instanceof TutorError ? e.kind : (e as Error)?.name === 'TypeError' ? 'unreachable' : 'bad-response';
  if (kind === 'rate-limit') return 'The provider says you hit its rate limit. Free tiers allow only a few requests per minute and per day — try again later.';
  if (kind === 'not-found')
    return provider === 'ollama'
      ? `Ollama doesn't have that model yet. Run \`ollama pull ${model ?? 'llama3.2:3b'}\`, then try again.`
      : 'The provider could not find that model. Check the model name in Settings (free model names change often).';
  if (kind === 'auth') return 'The provider rejected the API key. Check the key in Settings.';
  if (kind === 'unreachable')
    return provider === 'ollama'
      ? 'Could not reach Ollama at localhost:11434. Install it (`brew install ollama`), then start it with `ollama serve` and pull a model.'
      : 'Could not reach the tutor provider. Check your internet connection and the base URL in Settings.';
  return `The tutor returned an unexpected response (${(e as Error)?.message ?? 'unknown error'}).`;
}
