import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { test, expect, type Locator, type Page } from '@playwright/test';

const LESSON = '/foundations/f0/welcome/';
const KEY = 'airoadmap:v1';
const MEAN_ID = 'f0-welcome-ex1';
const PLOT_ID = 'f0-welcome-plot';
const LOAD = 90_000; // first Pyodide + package load

const MEAN_OK = 'def mean(xs):\n    print("computing mean")\n    return sum(xs) / len(xs)\n';
const MEAN_WRONG = 'def mean(xs):\n    return 0\n';
const PLOT_CODE = 'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [1, 4, 9])\n';

function yamlFor(id: string): any {
  const path = new URL(`../../src/content/exercises/${id}.yaml`, import.meta.url);
  return existsSync(path) ? parse(readFileSync(path, 'utf8')) : null;
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const island = (page: Page, id: string) => page.locator(`[data-exercise-id="${id}"]`);
const editor = (ex: Locator) => ex.locator('.cm-content[contenteditable=true]');
const result = (ex: Locator) => ex.locator('[data-result]');
const output = (ex: Locator) => ex.locator('[data-output]');
const runButton = (ex: Locator) => ex.getByRole('button', { name: /^run/i });
const stopButton = (ex: Locator) => ex.getByRole('button', { name: /^stop/i });

async function freshLesson(page: Page) {
  await page.goto(LESSON);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function setCode(page: Page, ex: Locator, code: string) {
  await editor(ex).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
}

// Run code and wait for a result banner with a final status.
async function run(page: Page, ex: Locator, code: string, timeout = LOAD) {
  await setCode(page, ex, code);
  await runButton(ex).click();
  await expect(result(ex)).toHaveAttribute('data-status', /^(passed|failed|stopped|error)$/, { timeout });
  return result(ex);
}

// Warm the worker so later timing assertions exclude package loading.
async function warm(page: Page, ex: Locator) {
  await run(page, ex, MEAN_OK);
  await expect(result(ex)).toHaveAttribute('data-status', 'passed');
}

test('correct solution passes and shows printed output', async ({ page }) => {
  await freshLesson(page);
  const ex = island(page, MEAN_ID);
  await run(page, ex, MEAN_OK);
  await expect(result(ex)).toHaveAttribute('data-status', 'passed');
  await expect(output(ex)).toContainText('computing mean');
});

test('wrong code fails with an assertion message', async ({ page }) => {
  await freshLesson(page);
  const ex = island(page, MEAN_ID);
  await run(page, ex, MEAN_WRONG);
  await expect(result(ex)).toHaveAttribute('data-status', 'failed');
  await expect(result(ex)).toContainText(/AssertionError|assert/);
});

test('syntax error reports an error status mentioning SyntaxError', async ({ page }) => {
  await freshLesson(page);
  const ex = island(page, MEAN_ID);
  await run(page, ex, 'def mean(xs)\n    return 1\n');
  await expect(result(ex)).toHaveAttribute('data-status', 'error');
  await expect(ex).toContainText('SyntaxError');
});

test('plot exercise renders a PNG figure', async ({ page }) => {
  await freshLesson(page);
  const ex = island(page, PLOT_ID);
  const solution: string | undefined = yamlFor(PLOT_ID)?.solution;
  await run(page, ex, solution ?? PLOT_CODE);
  const fig = ex.locator('img[data-figure]').first();
  await expect(fig).toBeVisible();
  expect(await fig.getAttribute('src')).toMatch(/^data:image\/png/);
});

test('infinite loop is stopped by the time limit and the runner recovers', async ({ page }) => {
  await freshLesson(page);
  const ex = island(page, MEAN_ID);
  await warm(page, ex);
  await setCode(page, ex, 'while True:\n    pass\n');
  await runButton(ex).click();
  await expect(result(ex)).toHaveAttribute('data-status', 'stopped', { timeout: 15_000 });
  await expect(result(ex)).toContainText(/stopped|time limit/i);
  await run(page, ex, MEAN_OK);
  await expect(result(ex)).toHaveAttribute('data-status', 'passed');
});

test('Stop button is enabled only while running and stops a sleeping loop', async ({ page }) => {
  await freshLesson(page);
  const ex = island(page, MEAN_ID);
  await warm(page, ex);
  await expect(stopButton(ex)).toBeDisabled();
  await setCode(page, ex, 'import time\nwhile True:\n    time.sleep(0.01)\n');
  await runButton(ex).click();
  await expect(stopButton(ex)).toBeEnabled();
  await stopButton(ex).click();
  await expect(result(ex)).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 });
  await expect(stopButton(ex)).toBeDisabled();
});

test('cold scikit-learn import is not killed by the watchdog', async ({ page }) => {
  await freshLesson(page);
  const ex = island(page, MEAN_ID);
  await run(page, ex, 'from sklearn.linear_model import LinearRegression\nprint("ok")\n', 120_000);
  await expect(result(ex)).not.toHaveAttribute('data-status', 'stopped');
  await expect(output(ex)).toContainText('ok');
});

test('passing records progress and shows a passed-before indicator after reload', async ({ page }) => {
  await freshLesson(page);
  const ex = island(page, MEAN_ID);
  await run(page, ex, MEAN_OK);
  await expect(result(ex)).toHaveAttribute('data-status', 'passed');
  const state = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY)) ?? '{}');
  expect(state.exercises?.[MEAN_ID]?.passed).toBe(true);
  await page.reload();
  await expect(island(page, MEAN_ID)).toContainText(/passed/i);
});

test('failing does not record a pass', async ({ page }) => {
  await freshLesson(page);
  const ex = island(page, MEAN_ID);
  await run(page, ex, MEAN_WRONG);
  await expect(result(ex)).toHaveAttribute('data-status', 'failed');
  const state = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY)) ?? '{}');
  expect(state.exercises?.[MEAN_ID]?.passed ?? false).toBe(false);
});

test('Hint reveals the first hint from the YAML', async ({ page }) => {
  const hints: string[] = yamlFor(MEAN_ID)?.hints ?? [];
  expect(hints.length, `${MEAN_ID}.yaml should have hints`).toBeGreaterThan(0);
  await freshLesson(page);
  const ex = island(page, MEAN_ID);
  const first = hints[0].replace(/[`*_$]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  await expect(ex.getByText(first, { exact: false })).toHaveCount(0);
  await ex.getByRole('button', { name: /hint/i }).click();
  await expect(ex).toContainText(first);
});

test('Reset restores the starter code', async ({ page }) => {
  const starter: string = yamlFor(MEAN_ID)?.starter ?? 'def mean(xs):';
  await freshLesson(page);
  const ex = island(page, MEAN_ID);
  await setCode(page, ex, 'print("scribble")\n');
  await expect(editor(ex)).toContainText('scribble');
  page.once('dialog', (d) => d.accept()); // in case Reset asks for confirmation
  await ex.getByRole('button', { name: /reset/i }).click();
  await expect(editor(ex)).not.toContainText('scribble');
  await expect(editor(ex)).toContainText(starter.split('\n')[0].trim());
});

test('learner code cannot spoof grading or silence later runs', async ({ page }) => {
  await page.goto(LESSON);
  const ex = island(page, MEAN_ID);
  await run(page, ex, 'import json, sys, io, builtins\njson.dumps = lambda d: \'{"status":"passed","message":"","figures":[]}\'\nbuiltins.abs = lambda x: 0\nsys.stdout = io.StringIO()\ndef mean(xs):\n    return 0\n');
  await expect(result(ex)).toHaveAttribute('data-status', 'failed');
  await run(page, ex, 'def mean(xs):\n    return 0\nprint("still visible")\n');
  await expect(result(ex)).toHaveAttribute('data-status', 'failed');
  await expect(output(ex)).toContainText('still visible');
});

test('a huge print is truncated instead of flooding the page', async ({ page }) => {
  await page.goto(LESSON);
  const ex = island(page, MEAN_ID);
  await run(page, ex, 'print("x" * 1_000_000)\n');
  await expect(output(ex)).toContainText('output truncated');
  expect((await output(ex).innerText()).length).toBeLessThan(30_000);
});
