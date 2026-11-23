import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { test, expect, type Locator, type Page } from '@playwright/test';

const KEY = 'airoadmap:v1';
const LESSON = '/foundations/f0/welcome/';
const ALL = `${LESSON}?quiz=all`;
const CHECK = '/foundations/f0/check/';

type Option = { text: string; correct?: boolean; why: string };
type Item = { id: string; type: string; prompt: string; explanation: string } & Record<string, any>;

// Every authored quiz item, so whatever the mastery check draws can be answered.
const QUIZ_DIR = fileURLToPath(new URL('../../src/content/quizzes/', import.meta.url));
const items: Item[] = (readdirSync(QUIZ_DIR, { recursive: true }) as string[])
  .filter((f) => /\.ya?ml$/.test(f))
  .flatMap((f) => parse(readFileSync(join(QUIZ_DIR, f), 'utf8')).items as Item[]);
const byId = new Map(items.map((i) => [i.id, i]));
const MCQ = items.find((i) => i.id.startsWith('f0-welcome') && i.type === 'mcq')!;

function plain(md: string): string {
  const pieces = md
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, '|')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/[*_`|]/)
    .map((s) => s.replace(/\s+/g, ' ').trim());
  return pieces.reduce((a, b) => (b.length > a.length ? b : a), '');
}

const fieldset = (page: Page, item: Item) => page.locator(`fieldset[data-item-id="${item.id}"]`);
const checkButton = (fs: Locator) => fs.getByRole('button', { name: /^check\b/i });
const feedback = (fs: Locator) => fs.locator('[data-feedback]');

async function currentOrder(fs: Locator, authored: string[]): Promise<string[]> {
  const texts = await fs.locator('ol li').allInnerTexts();
  return texts.map((t) => {
    const hits = authored.filter((a) => t.includes(plain(a)));
    if (!hits.length) throw new Error(`order list item "${t}" matches no authored item`);
    return hits.reduce((x, y) => (y.length > x.length ? y : x));
  });
}

async function arrange(fs: Locator, target: string[], authored: string[]) {
  for (let i = 0; i < target.length; i++) {
    let order = await currentOrder(fs, authored);
    let j = order.indexOf(target[i]);
    while (j > i) {
      await fs.locator('ol li').nth(j).getByRole('button', { name: /move .* up/i }).click();
      order = await currentOrder(fs, authored);
      j = order.indexOf(target[i]);
    }
  }
}

async function answer(page: Page, item: Item, correct: boolean) {
  const fs = fieldset(page, item);
  switch (item.type) {
    case 'mcq': {
      const opts: Option[] = item.options;
      await fs.getByRole('radio').nth(opts.findIndex((o) => !!o.correct === correct)).check();
      break;
    }
    case 'multi': {
      const opts: Option[] = item.options;
      const right = opts.flatMap((o, i) => (o.correct ? [i] : []));
      const wrong = opts.flatMap((o, i) => (o.correct ? [] : [i]));
      const chosen = correct ? right : wrong.length ? [...right, wrong[0]] : [right[0]];
      for (const i of chosen) await fs.getByRole('checkbox').nth(i).check();
      break;
    }
    case 'numeric': {
      const a: number = item.answer;
      await fs.locator('input[inputmode=decimal]').fill(correct ? String(a) : String(a + 1000 + Math.abs(a) * 10));
      break;
    }
    case 'output':
      await fs.locator('textarea').fill(correct ? item.answer : 'definitely not the output 9f3k');
      break;
    case 'order': {
      const authored: string[] = item.items;
      await expect(fs.locator('ol li')).toHaveCount(authored.length);
      if (correct) await arrange(fs, authored, authored);
      else if ((await currentOrder(fs, authored)).join('\0') === authored.join('\0'))
        await fs.locator('ol li').first().getByRole('button', { name: /move .* down/i }).click();
      break;
    }
    case 'cloze':
      await fs.getByRole('textbox').fill(correct ? item.accept[0] : 'zqxj not an answer');
      break;
    default:
      throw new Error(`unknown item type ${item.type}`);
  }
}

async function answerAndCheck(page: Page, item: Item, correct: boolean) {
  const fs = fieldset(page, item);
  await answer(page, item, correct);
  await checkButton(fs).click();
  await expect(feedback(fs)).toHaveAttribute('data-correct', String(correct));
}

const readState = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);

async function fresh(page: Page, url: string) {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

// Pretend time has passed: move one card's due date into the past, keeping its other fields.
async function makeDue(page: Page, id: string) {
  await page.evaluate(
    ({ k, id }) => {
      const s = JSON.parse(localStorage.getItem(k)!);
      s.cards[id] = { ...s.cards[id], dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString() };
      localStorage.setItem(k, JSON.stringify(s));
    },
    { k: KEY, id },
  );
}

async function answerAllRendered(page: Page, correct: boolean) {
  const check = page.locator('[data-mastery-check="f0"]');
  await expect(check.locator('fieldset[data-item-id]').first()).toBeVisible();
  const ids = await check.locator('fieldset[data-item-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')!));
  expect(ids.length).toBe(Math.min(12, items.filter((i) => i.id.startsWith('f0-')).length));
  await expect(check.getByText(`0 of ${ids.length} answered`)).toBeVisible();
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) throw new Error(`check rendered unknown item ${id}`);
    await answerAndCheck(page, item, correct);
  }
  await expect(check.getByText(`${ids.length} of ${ids.length} answered`)).toBeVisible();
  return ids;
}

test.describe('FSRS cards and review', () => {
  test('a wrong lesson answer creates a card graded Again, and it shows on /review/ once due', async ({ page }) => {
    await fresh(page, ALL);
    await answerAndCheck(page, MCQ, false);
    await expect.poll(async () => (await readState(page))?.cards?.[MCQ.id]).toBeTruthy();
    const s = await readState(page);
    expect(s.cards[MCQ.id].dueAt).toBeTruthy();
    expect(s.reviews).toContainEqual(expect.objectContaining({ itemId: MCQ.id, grade: 'Again' }));

    await makeDue(page, MCQ.id);
    await page.goto('/review/');
    await expect(page.locator(`[data-review] fieldset[data-item-id="${MCQ.id}"]`)).toBeVisible();
  });

  test('answering the same item again the same day adds no second review entry', async ({ page }) => {
    await fresh(page, ALL);
    await answerAndCheck(page, MCQ, false);
    await expect.poll(async () => (await readState(page))?.reviews?.length ?? 0).toBe(1);

    await page.reload();
    await answerAndCheck(page, MCQ, true);
    // Give any (incorrect) write a moment to land before asserting nothing changed.
    await page.waitForTimeout(300);
    const s = await readState(page);
    expect(s.reviews.filter((r: any) => r.itemId === MCQ.id)).toHaveLength(1);
    expect(s.reviews).toHaveLength(1);
  });

  test('fresh state: /review/ shows "Nothing due right now"', async ({ page }) => {
    await fresh(page, '/review/');
    await expect(page.locator('[data-review-empty]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /nothing due right now/i })).toBeVisible();
    await expect(page.locator('[data-review]')).toHaveCount(0);
  });
});

test.describe('mastery check', () => {
  test('answering every item correctly masters the module', async ({ page }) => {
    await fresh(page, CHECK);
    await answerAllRendered(page, true);
    const result = page.locator('[data-check-result]');
    await expect(result).toHaveAttribute('data-passed', 'true');
    await expect(result.getByRole('heading', { name: /module mastered/i })).toBeVisible();
    await expect.poll(async () => (await readState(page))?.mastery?.f0?.mastered).toBe(true);
    expect((await readState(page)).mastery.f0.attempts).toBe(1);
  });

  test('answering every item wrongly fails and links back to the weak lesson', async ({ page }) => {
    await fresh(page, CHECK);
    await answerAllRendered(page, false);
    const result = page.locator('[data-check-result]');
    await expect(result).toHaveAttribute('data-passed', 'false');
    await expect(result.getByRole('heading', { name: /not yet/i })).toBeVisible();
    await expect(result.locator(`a[href="${LESSON}"]`)).toBeVisible();
    await expect.poll(async () => (await readState(page))?.mastery?.f0?.attempts).toBe(1);
    expect((await readState(page)).mastery.f0.mastered).toBe(false);
  });

  test('module overview links to the mastery check', async ({ page }) => {
    await page.goto('/foundations/f0/');
    const link = page.getByRole('link', { name: /mastery check/i }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/foundations\/f0\/check\/?$/);
  });
});
