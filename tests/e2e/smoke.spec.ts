import { test, expect } from '@playwright/test';

test('sample lesson renders KaTeX', async ({ page }) => {
  await page.goto('/foundations/f0/welcome/');
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('.katex-display')).toHaveCount(1);
});
