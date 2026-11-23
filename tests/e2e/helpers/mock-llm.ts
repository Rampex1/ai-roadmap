import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

export type MockRequest = { method: string; url: string; headers: IncomingHttpHeaders; body: any };
export type Mode = 'stream' | 'rate-limit';

// Minimal OpenAI-compatible /chat/completions server with permissive CORS.
export async function startMockLLM(port: number, deltas = ['Hello', ' learner', '!']) {
  const requests: MockRequest[] = [];
  let mode: Mode = 'stream';
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const server: Server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: any = null;
      try { body = JSON.parse(raw); } catch {}
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      if (mode === 'rate-limit') {
        res.writeHead(429, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Rate limit exceeded', code: 429 } }));
        return;
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': keep-alive\n\n');
      for (const d of deltas) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: d } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((ok, fail) => server.once('error', fail).listen(port, ok));
  return {
    requests,
    setMode: (m: Mode) => (mode = m),
    reset: () => { requests.length = 0; mode = 'stream'; },
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
