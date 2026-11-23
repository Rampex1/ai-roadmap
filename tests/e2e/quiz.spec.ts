import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { test, expect, type Locator, type Page } from '@playwright/test';

const LESSON = '/foundations/f0/welcome/';
const ALL = `${LESSON}?quiz=all`;
const TYPES = ['mcq', 'multi', 'numeric', 'output', 'order', 'cloze'] as const;

type Option = { text: string; correct?: boolean; why: string };
type Item = { id: string; type: (typeof TYPES)[number]; prompt: string; explanation: string } & Record<string, any>;

const items: Item[] = parse(
  readFileSync(new URL('../../src/content/quizzes/foundations/f0/welcome.yaml', import.meta.url), 'utf8'),
).items;

// A plain-text fragment of a markdown string that survives rendering: drop math, unwrap links,
// split on emphasis/code markers and keep the longest piece.
function plain(md: string): string {
  const pieces = md
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, '|')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/[*_`|]/)
    .map((s) => s.replace(/\s+/g, ' ').trim());
  return pieces.reduce((a, b) => (b.length > a.length ? b : a), '');
}

const quiz = (page: Page) => page.locator('section[aria-labelledby]').filter({ hasText: /check your understanding/i });
const fieldset = (page: Page, item: Item) => page.locator(`fieldset[data-item-id="${item.id}"]`);
const checkButton = (fs: Locator) => fs.getByRole('button', { name: /^check\b/i });
const feedback = (fs: Locator) => fs.locator('[data-feedback]');

// Text of each list item in the order widget, mapped back to the authored item it contains.
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

async function answer(page: Page, item: Item, correct: boolean): Promise<number[]> {
  const fs = fieldset(page, item);
  switch (item.type) {
    case 'mcq': {
      const opts: Option[] = item.options;
      const i = opts.findIndex((o) => !!o.correct === correct);
      await fs.getByRole('radio').nth(i).check();
      return [i];
    }
    case 'multi': {
      const opts: Option[] = item.options;
      const right = opts.flatMap((o, i) => (o.correct ? [i] : []));
      const wrong = opts.flatMap((o, i) => (o.correct ? [] : [i]));
      // Wrong: all correct plus one extra incorrect option, or (if every option is correct) just the first one.
      const chosen = correct ? right : wrong.length ? [...right, wrong[0]] : [right[0]];
      for (const i of chosen) await fs.getByRole('checkbox').nth(i).check();
      return chosen;
    }
    case 'numeric': {
      const a: number = item.answer;
      const value = correct ? String(a) : String(a + 1000 + Math.abs(a) * 10);
      await fs.locator('input[inputmode=decimal]').fill(value);
      return [];
    }
    case 'output': {
      await expect(fs.locator('pre')).toContainText(String(item.code).trim().split('\n')[0].trim());
      await fs.locator('textarea').fill(correct ? item.answer : 'definitely not the output 9f3k');
      return [];
    }
    case 'order': {
      const authored: string[] = item.items;
      await expect(fs.locator('ol li')).toHaveCount(authored.length);
      if (correct) {
        await arrange(fs, authored, authored);
        expect(await currentOrder(fs, authored)).toEqual(authored);
      } else {
        const now = await currentOrder(fs, authored);
        if (now.join('\0') === authored.join('\0'))
          await fs.locator('ol li').first().getByRole('button', { name: /move .* down/i }).click();
        expect(await currentOrder(fs, authored)).not.toEqual(authored);
      }
      return [];
    }
    case 'cloze': {
      if (correct && !item.accept?.length) throw new Error(`cloze ${item.id} needs accept[] for this test`);
      await fs.getByRole('textbox').fill(correct ? item.accept[0] : 'zqxj not an answer');
      return [];
    }
  }
}

test.describe('quiz fixture', () => {
  test('welcome quiz has at least one item of each type', () => {
    for (const t of TYPES) expect(items.some((i) => i.type === t), `no ${t} item`).toBe(true);
  });
});

test.describe('quiz rendering', () => {
  test('quiz section renders with its heading at the end of the lesson', async ({ page }) => {
    await page.goto(ALL);
    await expect(quiz(page)).toBeVisible();
    await expect(quiz(page).getByRole('heading', { name: /check your understanding/i })).toBeVisible();
  });

  test('?quiz=all renders every item with its id and type', async ({ page }) => {
    await page.goto(ALL);
    await expect(quiz(page).locator('fieldset[data-item-id]')).toHaveCount(items.length);
    for (const item of items) {
      const fs = fieldset(page, item);
      await expect(fs).toHaveAttribute('data-type', item.type);
      await expect(fs.locator('legend')).toContainText(plain(item.prompt));
    }
  });

  test('without ?quiz=all at most 5 items render', async ({ page }) => {
    await page.goto(LESSON);
    await expect(quiz(page).locator('fieldset[data-item-id]').first()).toBeVisible();
    const n = await quiz(page).locator('fieldset[data-item-id]').count();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(Math.min(5, items.length));
  });

  test('each type renders its input widget', async ({ page }) => {
    await page.goto(ALL);
    for (const item of items) {
      const fs = fieldset(page, item);
      switch (item.type) {
        case 'mcq': await expect(fs.getByRole('radio')).toHaveCount(item.options.length); break;
        case 'multi': await expect(fs.getByRole('checkbox')).toHaveCount(item.options.length); break;
        case 'numeric': await expect(fs.locator('input[inputmode=decimal]')).toBeVisible(); break;
        case 'output':
          await expect(fs.locator('pre')).toBeVisible();
          await expect(fs.locator('textarea')).toBeVisible();
          break;
        case 'order':
          await expect(fs.locator('ol li')).toHaveCount(item.items.length);
          for (const li of await fs.locator('ol li').all()) {
            await expect(li.getByRole('button', { name: /move .* up/i })).toHaveCount(1);
            await expect(li.getByRole('button', { name: /move .* down/i })).toHaveCount(1);
          }
          break;
        case 'cloze': await expect(fs.getByRole('textbox')).toBeVisible(); break;
      }
      await expect(checkButton(fs)).toBeVisible();
    }
  });

  test('mcq option labels are the option text', async ({ page }) => {
    await page.goto(ALL);
    const item = items.find((i) => i.type === 'mcq')!;
    const radios = fieldset(page, item).getByRole('radio');
    for (const [i, o] of (item.options as Option[]).entries())
      await expect(radios.nth(i)).toHaveAccessibleName(new RegExp(plain(o.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('prompts render markdown: no literal ** and math renders with KaTeX', async ({ page }) => {
    await page.goto(ALL);
    for (const item of items) {
      const legend = fieldset(page, item).locator('legend');
      expect(await legend.innerText()).not.toContain('**');
      if (/\$[^$]+\$/.test(item.prompt)) await expect(legend.locator('.katex').first()).toBeAttached();
    }
  });
});

test.describe('grading feedback', () => {
  for (const item of items) {
    for (const correct of [true, false]) {
      test(`${item.type} ${item.id}: ${correct ? 'right' : 'wrong'} answer shows ${correct ? 'correct' : 'incorrect'} feedback`, async ({ page }) => {
        await page.goto(ALL);
        const fs = fieldset(page, item);
        const chosen = await answer(page, item, correct);
        await checkButton(fs).click();
        const fb = feedback(fs);
        await expect(fb).toBeVisible();
        await expect(fb).toHaveAttribute('data-correct', String(correct));
        await expect(fb).toContainText(correct ? /correct/i : /not quite|incorrect/i);
        await expect(fb).toContainText(plain(item.explanation));
        if (item.type === 'mcq' || item.type === 'multi')
          for (const i of chosen) await expect(fb).toContainText(plain(item.options[i].why));
      });
    }
  }
});

test.describe('keyboard', () => {
  test('first mcq radio can be selected with Space and checked with Enter', async ({ page }) => {
    await page.goto(ALL);
    const item = items.find((i) => i.type === 'mcq')!;
    const fs = fieldset(page, item);
    const radio = fs.getByRole('radio').first();
    await radio.focus();
    await page.keyboard.press('Space');
    await expect(radio).toBeChecked();
    await checkButton(fs).focus();
    await page.keyboard.press('Enter');
    await expect(feedback(fs)).toHaveAttribute('data-correct', String(!!item.options[0].correct));
  });
});
