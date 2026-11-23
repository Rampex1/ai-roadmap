#!/usr/bin/env node
// Every site-internal link, image, stylesheet and script in the built site must resolve to a file in dist.
// Usage: node scripts/check-links.mjs [--dist dist]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// href/src/srcset plus Astro island loaders (component-url, renderer-url). (?<![\w-]) skips data-href etc.
const ATTR = /(?<![\w-])(href|src|srcset|component-url|renderer-url)\s*=\s*["']([^"']*)["']/gi;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function exists(dist, path) {
  let p;
  try {
    p = decodeURIComponent(path);
  } catch {
    return false; // malformed %-escape: report as broken rather than crash
  }
  const candidates = p.endsWith('/') ? [join(dist, p, 'index.html')] : [join(dist, p), join(dist, `${p}.html`), join(dist, p, 'index.html')];
  return candidates.some((c) => existsSync(c) && statSync(c).isFile());
}

export function checkLinks(dist) {
  const errors = [];
  const pages = readdirSync(dist, { recursive: true }).map(String).filter((f) => f.endsWith('.html'));
  for (const page of pages) {
    const html = readFileSync(join(dist, page), 'utf8');
    const seen = new Set();
    for (const m of html.matchAll(ATTR)) {
      const values = m[1].toLowerCase() === 'srcset' ? m[2].split(',').map((s) => s.trim().split(/\s+/)[0]) : [m[2].trim()];
      for (const href of values) {
        if (!href || EXTERNAL.test(href) || seen.has(href)) continue;
        seen.add(href);
        const path = href.split('#')[0].split('?')[0];
        if (!path.startsWith('/')) continue; // relative links are not checked (site content uses absolute paths)
        if (!exists(dist, path)) errors.push(`${relative(process.cwd(), join(dist, page))}: broken link ${href}`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--dist');
  const dist = resolve(i > -1 ? process.argv[i + 1] : 'dist');
  const errors = checkLinks(dist);
  if (errors.length) {
    console.error(`check-links: ${errors.length} problem(s)\n` + errors.map((e) => `  ✗ ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('check-links: OK');
}
