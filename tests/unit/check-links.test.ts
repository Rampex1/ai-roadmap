import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('../../scripts/check-links.mjs', import.meta.url).pathname;
const load = async () => (await import(SCRIPT)).checkLinks as (distDir: string) => string[] | Promise<string[]>;

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const page = (body: string, head = '') =>
  `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

// A small dist: home, a nested lesson page, a flat .html page, and some assets.
const BASE: Record<string, string> = {
  'index.html': page('<h1>Home</h1>'),
  'foundations/f0/welcome/index.html': page('<h1>Welcome</h1>'),
  'about.html': page('<h1>About</h1>'),
  'glossary/index.html': page('<dl><dt id="gradient">Gradient</dt></dl>'),
  '_astro/app.js': 'console.log(1)',
  '_astro/style.css': 'body{}',
  'img/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'homework/f0.ipynb': '{}',
};

function dist(extra: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'check-links-'));
  temps.push(root);
  for (const [path, text] of Object.entries({ ...BASE, ...extra })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const errorsFor = async (extra: Record<string, string>) => (await load())(dist(extra));
const linksPage = (body: string, head = '') => ({ 'links/index.html': page(body, head) });

describe('checkLinks', () => {
  it('returns no errors for a dist with no links', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('accepts a link with a trailing slash to a directory index', async () => {
    expect(await errorsFor(linksPage('<a href="/foundations/f0/welcome/">w</a>'))).toEqual([]);
  });

  it('accepts a link to the site root', async () => {
    expect(await errorsFor(linksPage('<a href="/">home</a>'))).toEqual([]);
  });

  it('accepts a link without a trailing slash to a directory index', async () => {
    expect(await errorsFor(linksPage('<a href="/foundations/f0/welcome">w</a>'))).toEqual([]);
  });

  it('accepts a link that resolves to <path>.html', async () => {
    expect(await errorsFor(linksPage('<a href="/about">a</a>'))).toEqual([]);
  });

  it('accepts a link to an exact file', async () => {
    expect(await errorsFor(linksPage('<a href="/about.html">a</a><a href="/homework/f0.ipynb">nb</a>'))).toEqual([]);
  });

  it('accepts links with a #hash', async () => {
    expect(await errorsFor(linksPage('<a href="/glossary/#gradient">g</a>'))).toEqual([]);
  });

  it('accepts links with a ?query', async () => {
    expect(await errorsFor(linksPage('<a href="/foundations/f0/welcome/?tab=1">w</a>'))).toEqual([]);
  });

  it('accepts links with both ?query and #hash', async () => {
    expect(await errorsFor(linksPage('<a href="/glossary/?q=x#gradient">g</a>'))).toEqual([]);
  });

  it('ignores same-page #hash-only links', async () => {
    expect(await errorsFor(linksPage('<a href="#top">top</a>'))).toEqual([]);
  });

  it('accepts existing asset references in img, link and script', async () => {
    const extra = linksPage(
      '<img src="/img/logo.svg" alt=""><script src="/_astro/app.js"></script>',
      '<link rel="stylesheet" href="/_astro/style.css">',
    );
    expect(await errorsFor(extra)).toEqual([]);
  });

  it('reports a broken internal <a href> naming the page and the href', async () => {
    const errors = await errorsFor(linksPage('<a href="/nope/">x</a>'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/links.*broken link \/nope\//);
  });

  it('reports the original href (with hash) for a broken link', async () => {
    const errors = await errorsFor(linksPage('<a href="/missing/#frag">x</a>'));
    expect(errors.join('\n')).toContain('/missing/');
  });

  it('reports a broken <img src>', async () => {
    const errors = await errorsFor(linksPage('<img src="/img/missing.png" alt="">'));
    expect(errors.join('\n')).toMatch(/broken link \/img\/missing\.png/);
  });

  it('reports a broken <script src>', async () => {
    const errors = await errorsFor(linksPage('<script src="/_astro/gone.js"></script>'));
    expect(errors.join('\n')).toMatch(/broken link \/_astro\/gone\.js/);
  });

  it('reports a broken <link href>', async () => {
    const errors = await errorsFor(linksPage('', '<link rel="stylesheet" href="/_astro/gone.css">'));
    expect(errors.join('\n')).toMatch(/broken link \/_astro\/gone\.css/);
  });

  it('ignores http, https and mailto links', async () => {
    const extra = linksPage(
      '<a href="https://missing.csail.mit.edu/">m</a><a href="http://example.com/nope">e</a>' +
        '<a href="mailto:someone@example.com">mail</a><img src="https://cdn.example.com/x.png" alt="">',
    );
    expect(await errorsFor(extra)).toEqual([]);
  });

  it('treats protocol-relative //host links as external', async () => {
    const extra = linksPage('<a href="//cdn.example.com/x">cdn</a><script src="//cdn.example.com/x.js"></script>');
    expect(await errorsFor(extra)).toEqual([]);
  });

  it('scans nested pages and names each page with a broken link', async () => {
    const errors = await errorsFor({
      'a/index.html': page('<a href="/ghost-a/">x</a>'),
      'b/c/index.html': page('<a href="/ghost-b/">y</a>'),
    });
    const text = errors.join('\n');
    expect(errors).toHaveLength(2);
    expect(text).toMatch(/a.*broken link \/ghost-a\//);
    expect(text).toMatch(/b.*c.*broken link \/ghost-b\//);
  });

  it('reports every broken link on a page, not just the first', async () => {
    const errors = await errorsFor(linksPage('<a href="/x1/">1</a><a href="/foundations/f0/welcome/">ok</a><a href="/x2/">2</a>'));
    expect(errors).toHaveLength(2);
  });

  it('handles single-quoted and unquoted-adjacent attributes', async () => {
    const errors = await errorsFor(linksPage("<a class='x' href='/ghost/'>x</a><a href='/about'>ok</a>"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/broken link \/ghost\//);
  });

  it('does not treat relative links as site-internal', async () => {
    expect(await errorsFor(linksPage('<a href="../whatever/">rel</a><a href="sibling.html">s</a>'))).toEqual([]);
  });
});

describe('check-links CLI', () => {
  const run = (root: string) => spawnSync(process.execPath, [SCRIPT, '--dist', root], { encoding: 'utf8' });

  it('exits 0 for a dist with only valid links', () => {
    const r = run(dist(linksPage('<a href="/glossary/#gradient">g</a>')));
    expect(r.status, r.stderr).toBe(0);
  });

  it('exits non-zero and prints the broken link', () => {
    const r = run(dist(linksPage('<a href="/cli-ghost/">x</a>')));
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('broken link /cli-ghost/');
  });
});
