import { describe, it, expect } from 'vitest';
import { PRESETS, buildSystemPrompt, parseSSE, streamChat, TutorError, friendlyError, type Msg } from '@/lib/tutor';

const ctx = {
  lessonTitle: 'Gradient Descent',
  objectives: ['Explain the learning rate', 'Compute one update step by hand'],
};

const sse = (...deltas: string[]) =>
  deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`).join('') + 'data: [DONE]\n\n';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

type Call = { url: string; init: RequestInit };
function fakeFetch(res: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return res();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const okStream = (chunks: string[]) => () =>
  new Response(streamOf(chunks), { status: 200, headers: { 'content-type': 'text/event-stream' } });

const msgs: Msg[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
];

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of gen) out.push(d);
  return out;
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected rejection');
}

const header = (init: RequestInit, name: string): string | null => new Headers(init.headers).get(name);

describe('PRESETS', () => {
  it('includes Ollama on localhost without a key', () => {
    const p = PRESETS.find((x) => x.id === 'ollama');
    expect(p).toMatchObject({ baseURL: 'http://localhost:11434/v1', needsKey: false });
    expect(p!.label).toBeTruthy();
    expect(p!.model).toBeTruthy();
  });

  it('includes OpenRouter requiring a key', () => {
    const p = PRESETS.find((x) => x.id === 'openrouter');
    expect(p).toMatchObject({ baseURL: 'https://openrouter.ai/api/v1', needsKey: true });
    expect(p!.model).toBeTruthy();
  });

  it('has unique ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
});

describe('buildSystemPrompt', () => {
  it('contains the lesson title and every objective', () => {
    const p = buildSystemPrompt(ctx);
    expect(p).toContain('Gradient Descent');
    for (const o of ctx.objectives) expect(p).toContain(o);
  });

  it('instructs hints before full solutions', () => {
    expect(buildSystemPrompt(ctx)).toMatch(/hint/i);
  });

  it('includes the question when given', () => {
    expect(buildSystemPrompt({ ...ctx, question: 'What does eta control?' })).toContain('What does eta control?');
  });

  it('includes the error when given', () => {
    expect(buildSystemPrompt({ ...ctx, error: 'NameError: name x is not defined' })).toContain('NameError: name x is not defined');
  });

  it('includes a short section verbatim', () => {
    expect(buildSystemPrompt({ ...ctx, section: 'The update rule moves against the gradient.' })).toContain(
      'The update rule moves against the gradient.',
    );
  });

  it('works with no objectives', () => {
    expect(buildSystemPrompt({ lessonTitle: 'Empty', objectives: [] })).toContain('Empty');
  });

  it('caps a huge section so the prompt stays under ~12000 chars', () => {
    const p = buildSystemPrompt({ ...ctx, section: 'x'.repeat(200_000), question: 'Q?' });
    expect(p.length).toBeLessThanOrEqual(12_000);
    expect(p).toContain('Gradient Descent');
    for (const o of ctx.objectives) expect(p).toContain(o);
    expect(p).toContain('Q?');
  });

  it('keeps unusual characters intact', () => {
    const p = buildSystemPrompt({ lessonTitle: 'Bayes’ rule: P(A|B) — “ü” 🚀', objectives: ['$\\theta_{t+1}$'] });
    expect(p).toContain('Bayes’ rule: P(A|B) — “ü” 🚀');
    expect(p).toContain('$\\theta_{t+1}$');
  });
});

describe('parseSSE', () => {
  it('extracts deltas from several lines in one chunk', () => {
    const r = parseSSE(sse('Hello', ' learner').replace('data: [DONE]\n\n', ''));
    expect(r.deltas).toEqual(['Hello', ' learner']);
    expect(r.done).toBe(false);
    expect(r.rest).toBe('');
  });

  it('marks done on [DONE]', () => {
    const r = parseSSE(sse('!'));
    expect(r.deltas).toEqual(['!']);
    expect(r.done).toBe(true);
  });

  it('returns an incomplete trailing line in rest and completes it with the next chunk', () => {
    const full = sse('Hello', ' learner');
    const cut = full.indexOf('learner');
    const a = parseSSE(full.slice(0, cut));
    expect(a.deltas).toEqual(['Hello']);
    expect(a.done).toBe(false);
    expect(a.rest.length).toBeGreaterThan(0);
    const b = parseSSE(a.rest + full.slice(cut));
    expect(b.deltas).toEqual([' learner']);
    expect(b.done).toBe(true);
  });

  it('ignores comment keep-alives and blank lines', () => {
    const r = parseSSE(': keep-alive\n\n\n: OPENROUTER PROCESSING\n\n' + sse('ok'));
    expect(r.deltas).toEqual(['ok']);
    expect(r.done).toBe(true);
  });

  it('handles CRLF line endings', () => {
    const r = parseSSE(sse('a', 'b').replace(/\n/g, '\r\n'));
    expect(r.deltas).toEqual(['a', 'b']);
    expect(r.done).toBe(true);
  });

  it('skips chunks without content (role-only first delta, empty delta)', () => {
    const chunk =
      `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {} , finish_reason: 'stop' }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`;
    expect(parseSSE(chunk).deltas).toEqual(['x']);
  });

  it('returns nothing for an empty chunk', () => {
    expect(parseSSE('')).toEqual({ deltas: [], done: false, rest: '' });
  });

  it('keeps unicode content intact', () => {
    expect(parseSSE(sse('θ → ∇ 🚀')).deltas).toEqual(['θ → ∇ 🚀']);
  });
});

describe('streamChat', () => {
  it('yields deltas in order', async () => {
    const { fetchImpl } = fakeFetch(okStream([sse('Hello', ' learner', '!')]));
    expect(await collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl }))).toEqual([
      'Hello',
      ' learner',
      '!',
    ]);
  });

  it('reassembles events split across byte chunks', async () => {
    const body = sse('Hello', ' learner', '!');
    const parts = [body.slice(0, 7), body.slice(7, 40), body.slice(40, 41), body.slice(41)];
    const { fetchImpl } = fakeFetch(okStream(parts));
    expect((await collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl }))).join('')).toBe(
      'Hello learner!',
    );
  });

  it('reassembles multi-byte characters split across byte chunks', async () => {
    const bytes = new TextEncoder().encode(sse('🚀θ'));
    const i = bytes.indexOf(0xf0) + 2; // middle of the emoji
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(bytes.slice(0, i));
              c.enqueue(bytes.slice(i));
              c.close();
            },
          }),
          { status: 200 },
        ),
    );
    expect((await collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl }))).join('')).toBe('🚀θ');
  });

  it('POSTs {model, messages, stream:true} as JSON to {baseURL}/chat/completions', async () => {
    const { calls, fetchImpl } = fakeFetch(okStream([sse('a')]));
    await collect(streamChat({ baseURL: 'http://localhost:4399/v1', model: 'mock', messages: msgs, fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:4399/v1/chat/completions');
    expect(calls[0].init.method).toBe('POST');
    expect(header(calls[0].init, 'content-type')).toMatch(/application\/json/);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: 'mock', messages: msgs, stream: true });
  });

  it('sends Authorization: Bearer <key> when apiKey is given', async () => {
    const { calls, fetchImpl } = fakeFetch(okStream([sse('a')]));
    await collect(streamChat({ baseURL: 'http://x/v1', model: 'm', apiKey: 'sk-test', messages: msgs, fetchImpl }));
    expect(header(calls[0].init, 'authorization')).toBe('Bearer sk-test');
  });

  it('sends no Authorization header without apiKey', async () => {
    const { calls, fetchImpl } = fakeFetch(okStream([sse('a')]));
    await collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl }));
    expect(header(calls[0].init, 'authorization')).toBeNull();
  });

  it('sends no Authorization header for an empty apiKey', async () => {
    const { calls, fetchImpl } = fakeFetch(okStream([sse('a')]));
    await collect(streamChat({ baseURL: 'http://x/v1', model: 'm', apiKey: '', messages: msgs, fetchImpl }));
    expect(header(calls[0].init, 'authorization')).toBeNull();
  });

  it('passes the abort signal to fetch', async () => {
    const { calls, fetchImpl } = fakeFetch(okStream([sse('a')]));
    const ac = new AbortController();
    await collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, signal: ac.signal, fetchImpl }));
    expect(calls[0].init.signal).toBe(ac.signal);
  });

  it('stops at [DONE] even if more data follows', async () => {
    const { fetchImpl } = fakeFetch(okStream([sse('a') + sse('ignored')]));
    expect(await collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl }))).toEqual(['a']);
  });

  it('throws TutorError kind rate-limit on 429', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('{"error":"rate"}', { status: 429 }));
    const e = await caught(collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl })));
    expect(e).toBeInstanceOf(TutorError);
    expect((e as TutorError).kind).toBe('rate-limit');
  });

  it('throws TutorError kind auth on 401', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('nope', { status: 401 }));
    const e = await caught(collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl })));
    expect(e).toBeInstanceOf(TutorError);
    expect((e as TutorError).kind).toBe('auth');
  });

  it('throws TutorError kind auth on 403', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('nope', { status: 403 }));
    const e = await caught(collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl })));
    expect((e as TutorError).kind).toBe('auth');
  });

  it('throws TutorError on 500', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('boom', { status: 500 }));
    const e = await caught(collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl })));
    expect(e).toBeInstanceOf(TutorError);
  });

  it('throws TutorError kind unreachable when fetch rejects with TypeError', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const e = await caught(collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl })));
    expect(e).toBeInstanceOf(TutorError);
    expect((e as TutorError).kind).toBe('unreachable');
  });

  it('TutorError is an Error', () => {
    expect(TutorError.prototype).toBeInstanceOf(Error);
  });
});

describe('friendlyError', () => {
  async function errFor(status: number): Promise<unknown> {
    const { fetchImpl } = fakeFetch(() => new Response('x', { status }));
    return caught(collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl })));
  }
  async function networkErr(): Promise<unknown> {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    return caught(collect(streamChat({ baseURL: 'http://x/v1', model: 'm', messages: msgs, fetchImpl })));
  }

  it('429 mentions the rate limit and trying later', async () => {
    expect(friendlyError(await errFor(429), 'openrouter')).toMatch(/rate limit|try (again )?later/i);
  });

  it('401 mentions the API key', async () => {
    expect(friendlyError(await errFor(401), 'openrouter')).toMatch(/api key/i);
  });

  it('403 mentions the API key', async () => {
    expect(friendlyError(await errFor(403), 'openrouter')).toMatch(/api key/i);
  });

  it('network failure says the provider is not reachable', async () => {
    expect(friendlyError(await networkErr(), 'openrouter')).toMatch(/reach/i);
  });

  it('network failure for ollama hints at starting or installing Ollama', async () => {
    const m = friendlyError(await networkErr(), 'ollama');
    expect(m).toMatch(/reach/i);
    expect(m).toMatch(/ollama serve|install/i);
  });

  it('accepts a raw TypeError', () => {
    expect(friendlyError(new TypeError('Failed to fetch'), 'custom')).toMatch(/reach/i);
  });

  it('returns a non-empty message for unknown values', () => {
    for (const v of [undefined, null, 'oops', 42, {}]) {
      const m = friendlyError(v, 'custom');
      expect(typeof m).toBe('string');
      expect(m.length).toBeGreaterThan(0);
    }
  });
});

describe('tutor review fixes', () => {
  it('turns an in-stream error into a TutorError instead of an empty reply', async () => {
    const { streamChat, TutorError } = await import('@/lib/tutor');
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"error":{"message":"Rate limit exceeded"}}\n\n')); c.close(); } });
    const fetchImpl = async () => new Response(body, { status: 200 });
    const run = async () => { for await (const _ of streamChat({ baseURL: 'x', model: 'm', messages: [], fetchImpl: fetchImpl as any })) {} };
    await expect(run()).rejects.toBeInstanceOf(TutorError);
  });
  it('maps 404 to a model-not-found hint, with ollama pull for Ollama', async () => {
    const { friendlyError, TutorError } = await import('@/lib/tutor');
    expect(friendlyError(new TutorError('not-found', 'HTTP 404'), 'ollama', 'qwen3:4b')).toMatch(/ollama pull qwen3:4b/);
    expect(friendlyError(new TutorError('not-found', 'HTTP 404'), 'openrouter')).toMatch(/model name/i);
  });
  it('caps question and error inside the prompt', async () => {
    const { buildSystemPrompt } = await import('@/lib/tutor');
    const p = buildSystemPrompt({ lessonTitle: 'T', objectives: [], question: 'q'.repeat(50_000), error: 'e'.repeat(50_000) });
    expect(p.length).toBeLessThan(12_000);
  });
});
