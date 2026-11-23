import { test, expect } from '@playwright/test';

const LESSON = '/foundations/f0/welcome/';
const LOCAL = ['localhost', '127.0.0.1'];

test.setTimeout(180_000);

test('lesson, math, code runner and search work with zero off-host requests', async ({ page }) => {
  const aborted: string[] = [];
  await page.route('**/*', (r) => {
    const url = r.request().url();
    if (LOCAL.includes(new URL(url).hostname)) return r.continue();
    aborted.push(url);
    return r.abort();
  });

  await page.goto(LESSON);
  await expect(page.locator('.katex').first()).toBeVisible();

  const ex = page.locator('[data-exercise-id="f0-welcome-ex1"]');
  await ex.locator('.cm-content[contenteditable=true]').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText('def mean(xs):\n    return sum(xs) / len(xs)\n');
  await ex.getByRole('button', { name: /^run/i }).click();
  await expect(ex.locator('[data-result]')).toHaveAttribute('data-status', 'passed', { timeout: 90_000 });

  await page.getByRole('button', { name: /search/i }).first().click();
  await page.getByRole('dialog').getByRole('searchbox').fill('gradient');
  await expect(page.locator('.pagefind-ui__result').first()).toBeVisible({ timeout: 15_000 });

  expect(aborted).toEqual([]);
});
