import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const LESSON = '/foundations/f0/welcome/';
const LESSON_ID = 'foundations/f0/welcome';
const KEY = 'airoadmap:v1';

const markButton = (page: Page) => page.getByRole('button', { name: /mark (as )?complete/i });
const completed = (page: Page) => page.getByText(/completed/i).first();
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);

async function freshLesson(page: Page) {
  await page.goto(LESSON);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function completeLesson(page: Page) {
  await freshLesson(page);
  await markButton(page).click();
  await expect(completed(page)).toBeVisible();
}

async function exportProgress(page: Page) {
  await page.goto('/settings/');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /export/i }).click(),
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: readFileSync(path, 'utf8') };
}

test.describe('lesson completion', () => {
  test('mark complete button switches to a completed state', async ({ page }) => {
    await freshLesson(page);
    await expect(markButton(page)).toBeVisible();
    await markButton(page).click();
    await expect(completed(page)).toBeVisible();
  });

  test('completed state survives a reload and is stored in localStorage', async ({ page }) => {
    await completeLesson(page);
    await page.reload();
    await expect(completed(page)).toBeVisible();
    expect(await stored(page)).toContain(LESSON_ID);
  });
});

test.describe('settings: export, reset, import', () => {
  test('export downloads progress-YYYY-MM-DD.json containing the completed lesson', async ({ page }) => {
    await completeLesson(page);
    const { name, text } = await exportProgress(page);
    expect(name).toMatch(/^progress-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(text).lessons[LESSON_ID].done).toBe(true);
  });

  test('reset clears progress and importing the export restores it', async ({ page }) => {
    await completeLesson(page);
    const { name, text } = await exportProgress(page);

    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /reset|clear/i }).first().click();
    await expect.poll(async () => (await stored(page)) ?? '').not.toContain(LESSON_ID);

    await page.goto(LESSON);
    await expect(markButton(page)).toBeVisible();

    await page.goto('/settings/');
    await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect.poll(async () => (await stored(page)) ?? '').toContain(LESSON_ID);

    await page.goto(LESSON);
    await expect(completed(page)).toBeVisible();
  });

  test('importing an invalid file shows an error and keeps existing progress', async ({ page }) => {
    await completeLesson(page);
    const before = await stored(page);

    await page.goto('/settings/');
    await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
    await expect(page.getByRole('alert').or(page.getByText(/invalid|could not/i)).first()).toBeVisible();

    expect(await stored(page)).toBe(before);
    await page.goto(LESSON);
    await expect(completed(page)).toBeVisible();
  });
});

test.describe('debug page', () => {
  test('shows the origin and the raw stored state', async ({ page }) => {
    await completeLesson(page);
    await page.goto('/debug/');
    await expect(page.getByText('http://localhost:4322').first()).toBeVisible();
    await expect(page.getByText(LESSON_ID).first()).toBeVisible();
  });
});
