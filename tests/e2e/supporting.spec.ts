import { readFileSync, readdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { parse } from 'yaml';

const LESSON = '/foundations/f0/welcome/';
const GLOSSARY = '/glossary/';
const RESOURCES = '/resources/';

type Glossary = { slug: string; term: string; short: string; related?: string[] };
type Resource = { slug: string; title: string; url: string; kind: string; free: boolean; modules?: string[] };

const dir = (p: string) => new URL(`../../${p}/`, import.meta.url);
function readAll<T>(p: string): T[] {
  return readdirSync(dir(p))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ slug: f.replace(/\.ya?ml$/, ''), ...parse(readFileSync(new URL(f, dir(p)), 'utf8')) }) as T);
}
const glossary = readAll<Glossary>('src/content/glossary');
const resources = readAll<Resource>('src/content/resources');
const missingSemester = resources.find((r) => r.slug === 'missing-semester')!;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sidebar = (page: Page) => page.locator('nav[aria-label="Main"], .sidebar-content').first();

test.describe('glossary page', () => {
  test('responds 200 with a heading', async ({ page }) => {
    const res = await page.goto(GLOSSARY);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText(/glossary/i);
  });

  test('has at least one entry to check', () => {
    expect(glossary.length).toBeGreaterThan(0);
  });

  for (const g of glossary) {
    test(`lists "${g.term}" as a heading or <dt> with id="${g.slug}"`, async ({ page }) => {
      await page.goto(GLOSSARY);
      const el = page.locator(`main [id="${g.slug}"]`);
      await expect(el).toHaveCount(1);
      const tag = await el.evaluate((n) => n.tagName.toLowerCase());
      expect(['h2', 'h3', 'h4', 'dt']).toContain(tag);
      await expect(el).toContainText(g.term);
    });

    test(`shows the short definition for "${g.term}"`, async ({ page }) => {
      await page.goto(GLOSSARY);
      await expect(page.locator('main')).toContainText(g.short);
    });

    for (const rel of g.related ?? []) {
      test(`links "${g.term}" to related term #${rel}`, async ({ page }) => {
        await page.goto(GLOSSARY);
        await expect(page.locator(`main a[href="#${rel}"], main a[href="${GLOSSARY}#${rel}"]`).first()).toBeVisible();
      });
    }
  }

  test('deep-links to an entry by slug', async ({ page }) => {
    const g = glossary[0];
    await page.goto(`${GLOSSARY}#${g.slug}`);
    await expect(page.locator(`[id="${g.slug}"]`)).toBeInViewport();
  });
});

test.describe('resources page', () => {
  test('responds 200 with a heading', async ({ page }) => {
    const res = await page.goto(RESOURCES);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText(/resources/i);
  });

  test('has at least one resource to check', () => {
    expect(resources.length).toBeGreaterThan(0);
  });

  for (const r of resources) {
    test(`links "${r.title}" to its url with rel=noopener`, async ({ page }) => {
      await page.goto(RESOURCES);
      const link = page.locator(`main a[href="${r.url}"]`, { hasText: r.title });
      await expect(link).toHaveCount(1);
      expect((await link.getAttribute('rel')) ?? '').toMatch(/\bnoopener\b/);
    });

    test(`labels "${r.title}" with its kind "${r.kind}"`, async ({ page }) => {
      await page.goto(RESOURCES);
      // Either grouped under a heading naming the kind, or the entry itself carries a kind label.
      const link = page.locator(`main a[href="${r.url}"]`).first();
      const kind = new RegExp(`\\b${escape(r.kind)}s?\\b`, 'i');
      const entryText = (await link.locator('xpath=ancestor::*[self::li or self::article or self::div or self::tr][1]').textContent()) ?? '';
      const groupHeading = await link.evaluate((a) => {
        // Nearest preceding h2/h3 in document order.
        const hs = Array.from(document.querySelectorAll('main h2, main h3'));
        let last = '';
        for (const h of hs) {
          if (h.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) last = h.textContent ?? '';
        }
        return last;
      });
      expect(kind.test(entryText) || kind.test(groupHeading), `entry: "${entryText}" / heading: "${groupHeading}"`).toBe(true);
    });

    test(`${r.free ? 'shows' : 'does not show'} a "free" badge for "${r.title}"`, async ({ page }) => {
      await page.goto(RESOURCES);
      const link = page.locator(`main a[href="${r.url}"]`).first();
      const entry = link.locator('xpath=ancestor::*[self::li or self::article or self::div or self::tr][1]');
      const text = (await entry.textContent()) ?? '';
      if (r.free) expect(text).toMatch(/\bfree\b/i);
      else expect(text.replace(r.title, '')).not.toMatch(/\bfree\b/i);
    });
  }
});

test.describe('sidebar', () => {
  test('links to the glossary and the resources pages', async ({ page }) => {
    await page.goto(GLOSSARY);
    await expect(sidebar(page).locator(`a[href="${GLOSSARY}"]`)).toHaveCount(1);
    await expect(sidebar(page).locator(`a[href="${RESOURCES}"]`)).toHaveCount(1);
  });
});

test.describe('lesson goDeeper', () => {
  test('welcome lesson shows a "Go deeper" link to its resource', async ({ page }) => {
    expect(missingSemester, 'src/content/resources/missing-semester.yaml').toBeTruthy();
    await page.goto(LESSON);
    const link = page.locator(`main a[href="${missingSemester.url}"]`);
    await expect(link.first()).toBeVisible();
    const linkText = (await link.first().textContent()) ?? '';
    const hasHeading = (await page.locator('main :is(h2,h3,h4)', { hasText: /go deeper/i }).count()) > 0;
    if (!/go deeper/i.test(linkText)) {
      expect(hasHeading, 'link text says "Go deeper" or a "Go deeper" heading exists').toBe(true);
      expect(linkText).toContain(missingSemester.title);
    }
  });
});

test.describe('Term links to the glossary', () => {
  test('the gradient term links to /glossary/#gradient', async ({ page }) => {
    await page.goto(LESSON);
    const term = page.locator('[data-term="gradient"]').first();
    await expect(term).toBeVisible();
    const href = `${GLOSSARY}#gradient`;
    const isLink = await term.evaluate((el, h) => el.tagName === 'A' && el.getAttribute('href') === h, href);
    const inner = await term.locator(`a[href="${href}"]`).count();
    const outer = await term.locator(`xpath=ancestor::a[@href="${href}"]`).count();
    expect(isLink || inner > 0 || outer > 0).toBe(true);
  });

  test('the gradient term still exposes its tooltip', async ({ page }) => {
    await page.goto(LESSON);
    const term = page.locator('[data-term="gradient"]').first();
    const describedBy = await term.getAttribute('aria-describedby');
    const tip = describedBy ? page.locator(`[id="${describedBy}"]`) : term.locator('[role="tooltip"]');
    await expect(tip).toHaveCount(1);
    await expect(tip).toContainText(glossary.find((g) => g.slug === 'gradient')!.short);
  });
});
