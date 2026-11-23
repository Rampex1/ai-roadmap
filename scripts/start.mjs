#!/usr/bin/env node
// `npm run start`: build, then preview on localhost:4321. `--serve` skips the build.
// Progress lives in localStorage for http://localhost:4321, so never fall back to another port.
import { connect } from 'node:net';
import { spawnSync } from 'node:child_process';

const PORT = 4321;

// Resolves true if something accepts connections on host:PORT. A connect probe (not a bind
// probe) also catches servers on 0.0.0.0, which macOS lets a second process shadow.
const busy = (host) =>
  new Promise((done) => {
    const s = connect({ port: PORT, host, timeout: 1000 });
    s.once('connect', () => (s.destroy(), done(true)));
    s.once('timeout', () => (s.destroy(), done(false)));
    s.once('error', () => done(false));
  });

for (const host of ['127.0.0.1', 'localhost', '::1']) {
  if (await busy(host)) {
    console.error(`Port ${PORT} is in use — stop the other server first (progress is tied to http://localhost:${PORT})`);
    process.exit(1);
  }
}

const astro = (...args) => {
  const r = spawnSync('npx', ['astro', ...args], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
if (!process.argv.includes('--serve')) astro('build');
// --ignore-lock: always run in the foreground (Astro 7 auto-backgrounds under coding agents); the probe above guards the port.
astro('preview', '--port', String(PORT), '--host', 'localhost', '--ignore-lock');
