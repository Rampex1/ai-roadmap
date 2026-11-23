import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { test, expect, type Page } from '@playwright/test';
import { startMockLLM } from './helpers/mock-llm';

const PORT = 4399;
const BASE_URL = `http://localhost:${PORT}/v1`;
const LESSON = '/foundations/f0/welcome/';
const KEY = 'sk-test';

type Item = { id: string; type: string; prompt: string; options?: { text: string; correct?: boolean }[] };
const items: Item[] = parse(
  readFileSync(new URL('../../src/content/quizzes/foundations/f0/welcome.yaml', import.meta.url), 'utf8'),
).items;
// A multi-choice item with a plain-text prompt (no math/markup) so its text is easy to find again.
const explainItem = items.find((i) => i.type === 'multi' && !/[$*_`]/.test(i.prompt))!;

let mock: Awaited<ReturnType<typeof startMockLLM>>;
test.beforeAll(async () => {
  mock = await startMockLLM(PORT);
});
test.afterAll(async () => {
  await mock.close();
});
test.beforeEach(() => mock.reset());

const drawer = (page: Page) => page.getByRole('dialog', { name: /tutor/i });
const askButton = (page: Page) => page.getByRole('button', { name: /ask the tutor/i });
const question = (page: Page) => drawer(page).getByLabel(/your question/i);

async function configureCustom(page: Page) {
  await page.goto('/settings/');
  await page.getByLabel(/provider/i).selectOption({ label: 'Custom' });
  await page.getByLabel(/base url/i).fill(BASE_URL);
  await page.getByLabel(/model/i).fill('mock');
  await page.getByLabel(/api key/i).fill(KEY);
  await page.getByRole('button', { name: /save tutor/i }).click();
}

async function ask(page: Page, text: string) {
  await page.goto(LESSON);
  await askButton(page).click();
  await expect(drawer(page)).toBeVisible();
  await question(page).fill(text);
  await drawer(page).getByRole('button', { name: /send/i }).click();
}

test.describe('tutor settings', () => {
  test('settings has a Tutor section with provider presets and Custom', async ({ page }) => {
    await page.goto('/settings/');
    await expect(page.getByRole('heading', { name: /tutor/i }).first()).toBeVisible();
    const select = page.getByLabel(/provider/i);
    const labels = await select.locator('option').allInnerTexts();
    expect(labels.some((l) => /ollama/i.test(l))).toBe(true);
    expect(labels.some((l) => /openrouter/i.test(l))).toBe(true);
    expect(labels.some((l) => /custom/i.test(l))).toBe(true);
    await expect(page.getByLabel(/base url/i)).toBeVisible();
    await expect(page.getByLabel(/model/i)).toBeVisible();
    await expect(page.getByLabel(/api key/i)).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: /save tutor/i })).toBeVisible();
  });

  test('Custom provider accepts any base URL and keeps it after reload', async ({ page }) => {
    await configureCustom(page);
    await page.reload();
    await expect(page.getByLabel(/base url/i)).toHaveValue(BASE_URL);
    await expect(page.getByLabel(/model/i)).toHaveValue('mock');
  });

  test('exported progress does not contain the API key', async ({ page }) => {
    await configureCustom(page);
    await page.reload();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /export/i }).click(),
    ]);
    const text = readFileSync(await download.path(), 'utf8');
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).settings.tutor.baseURL).toBe(BASE_URL);
  });
});

test.describe('tutor drawer', () => {
  test('every lesson has an Ask the tutor button that opens the tutor dialog', async ({ page }) => {
    await page.goto(LESSON);
    await askButton(page).click();
    await expect(drawer(page)).toBeVisible();
  });

  test('without a configured provider the drawer links to settings', async ({ page }) => {
    await page.goto(LESSON);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await askButton(page).click();
    await expect(drawer(page).locator('a[href$="/settings/"]').first()).toBeVisible();
  });

  test('streams the answer from the configured provider', async ({ page }) => {
    await configureCustom(page);
    await ask(page, 'What is a learning rate?');
    await expect(drawer(page)).toContainText('Hello learner!');
  });

  test('request carries the lesson title in the system prompt, the question, and the bearer key', async ({ page }) => {
    await configureCustom(page);
    await ask(page, 'What is a learning rate?');
    await expect(drawer(page)).toContainText('Hello learner!');
    const post = mock.requests.find((r) => r.method === 'POST');
    expect(post, 'mock server received no POST').toBeTruthy();
    expect(post!.url).toBe('/v1/chat/completions');
    expect(post!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(post!.body.model).toBe('mock');
    expect(post!.body.stream).toBe(true);
    expect(post!.body.messages[0].role).toBe('system');
    expect(post!.body.messages[0].content).toContain('Welcome');
    expect(JSON.stringify(post!.body.messages)).toContain('What is a learning rate?');
  });

  test('a 429 from the provider shows a rate-limit message', async ({ page }) => {
    mock.setMode('rate-limit');
    await configureCustom(page);
    await ask(page, 'Hi');
    await expect(drawer(page)).toContainText(/rate limit|try again later/i);
  });
});

test.describe('explain this', () => {
  test('a wrong quiz answer offers Explain, which opens the tutor with the question', async ({ page }) => {
    await configureCustom(page);
    await page.goto(`${LESSON}?quiz=all`);
    const fs = page.locator(`fieldset[data-item-id="${explainItem.id}"]`);
    const opts = explainItem.options!;
    const chosen = [...opts.flatMap((o, i) => (o.correct ? [i] : [])), opts.findIndex((o) => !o.correct)];
    for (const i of chosen) await fs.getByRole('checkbox').nth(i).check();
    await fs.getByRole('button', { name: /^check\b/i }).click();
    const fb = fs.locator('[data-feedback]');
    await expect(fb).toHaveAttribute('data-correct', 'false');
    await fb.getByRole('button', { name: /explain/i }).click();
    await expect(drawer(page)).toBeVisible();

    const fragment = explainItem.prompt.slice(0, 30);
    await expect
      .poll(async () => {
        const typed = await question(page).inputValue().catch(() => '');
        const sent = mock.requests.map((r) => JSON.stringify(r.body?.messages ?? '')).join('\n');
        return typed.includes(fragment) || sent.includes(fragment);
      })
      .toBe(true);
  });
});
