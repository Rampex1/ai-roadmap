import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { parse } from 'yaml';

const LESSON = '/foundations/f0/welcome/';
const MODULE = '/foundations/f0/';

const read = (p: string) => parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const f0 = read('src/content/modules/f0.yaml') as { title: string; objectives: string[] };
const gradient = read('src/content/glossary/gradient.yaml') as { term: string; short: string };

test.describe('module overview page', () => {
  test('shows the module title in an h1', async ({ page }) => {
    const res = await page.goto(MODULE);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText(f0.title);
  });

  test('lists every module objective', async ({ page }) => {
    await page.goto(MODULE);
    for (const objective of f0.objectives) {
      await expect(page.locator('li', { hasText: objective }).first()).toBeVisible();
    }
  });

  test('links to each lesson', async ({ page }) => {
    await page.goto(MODULE);
    await expect(page.locator(`main a[href="${LESSON}"]`).first()).toBeVisible();
  });
});

test.describe('sidebar', () => {
  const sidebar = (page: Page) => page.locator('nav[aria-label="Main"], .sidebar-content').first();

  test('links to the current lesson', async ({ page }) => {
    await page.goto(LESSON);
    await expect(sidebar(page).locator(`a[href="${LESSON}"]`)).toHaveCount(1);
  });

  test('shows no links to other courses', async ({ page }) => {
    await page.goto(LESSON);
    const hrefs = await sidebar(page).locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.filter((h) => /^\/(mle|research|llm)\//.test(h))).toEqual([]);
  });
});

test.describe('Term component', () => {
  test('renders the glossary term', async ({ page }) => {
    await page.goto(LESSON);
    const term = page.locator('[data-term="gradient"]').first();
    await expect(term).toBeVisible();
    await expect(term).toContainText(new RegExp(gradient.term, 'i'));
  });

  test('exposes the short definition via title or role=tooltip', async ({ page }) => {
    await page.goto(LESSON);
    const term = page.locator('[data-term="gradient"]').first();
    await expect(term).toHaveCount(1);
    const title = (await term.getAttribute('title')) ?? '';
    const describedBy = await term.getAttribute('aria-describedby');
    const tooltip = describedBy
      ? page.locator(`[id="${describedBy}"]`)
      : term.locator('[role="tooltip"]').or(page.locator('[role="tooltip"]'));
    const tooltipText = (await tooltip.count()) ? ((await tooltip.first().textContent()) ?? '') : '';
    expect(title + ' ' + tooltipText).toContain(gradient.short);
  });
});

test.describe('Figure component', () => {
  test('renders a figure with a caption and an image', async ({ page }) => {
    await page.goto(LESSON);
    const figure = page.locator('main figure', { has: page.locator('figcaption') }).first();
    await expect(figure).toBeVisible();
    await expect(figure.locator('figcaption')).not.toBeEmpty();
    await expect(figure.locator('img, svg').first()).toBeVisible();
  });
});

test.describe('accessibility', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const path of [LESSON, MODULE]) {
      test(`no serious/critical axe violations on ${path} (${theme})`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem('starlight-theme', t), theme);
        const res = await page.goto(path);
        expect(res?.status()).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const { violations } = await new AxeBuilder({ page }).analyze();
        const bad = violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        expect(bad).toEqual([]);
      });
    }
  }
});

test('lesson page makes no remote requests', async ({ page }) => {
  const remote: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (/^(https?|wss?):$/.test(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      remote.push(req.url());
    }
  });
  await page.goto(LESSON, { waitUntil: 'networkidle' });
  expect(remote).toEqual([]);
});

test('custom theme stylesheet defines --air-brand', async ({ page }) => {
  await page.goto(LESSON);
  const brand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--air-brand').trim(),
  );
  expect(brand).not.toBe('');
});
