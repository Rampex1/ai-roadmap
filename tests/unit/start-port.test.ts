import { it, expect } from 'vitest';
import { createServer, connect, type Server } from 'node:net';
import { spawn } from 'node:child_process';

const SCRIPT = new URL('../../scripts/start.mjs', import.meta.url).pathname;

const portTaken = () =>
  new Promise<boolean>((done) => {
    const s = connect({ port: 4321, host: 'localhost' });
    s.once('connect', () => (s.destroy(), done(true)));
    s.once('error', () => done(false));
  });

it('start.mjs --serve exits 1 with "Port 4321 is in use" when localhost:4321 is taken', async (ctx) => {
  if (await portTaken()) ctx.skip('port 4321 is already in use by another process; cannot run this test');
  const server: Server = createServer((sock) => sock.destroy());
  await new Promise<void>((ok, fail) => server.once('error', fail).listen(4321, 'localhost', ok));
  try {
    const { code, out } = await new Promise<{ code: number | null; out: string }>((done) => {
      const p = spawn(process.execPath, [SCRIPT, '--serve'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('close', (code) => done({ code, out }));
    });
    expect(code).toBe(1);
    expect(out).toContain('Port 4321 is in use');
  } finally {
    await new Promise((r) => server.close(r));
  }
}, 15000);
