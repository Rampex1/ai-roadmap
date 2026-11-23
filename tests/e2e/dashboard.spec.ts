import { test, expect, type Page } from '@playwright/test';

const KEY = 'airoadmap:v1';
const LESSON = '/foundations/f0/welcome/';
const LESSON_ID = 'foundations/f0/welcome';
const DAY = 86_400_000;

const COURSES = { f: 'foundations', a: 'mle', b: 'research', c: 'llm' } as const;
const range = (p: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${p}${from + i}`);
const MODULES = [...range('f', 0, 11), ...range('a', 1, 12), ...range('b', 0, 14), ...range('c', 1, 12)];
const modulePath = (id: string) => `/${COURSES[id[0] as keyof typeof COURSES]}/${id}/`;

const readState = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);

// Read-modify-write the stored state (starting from an empty v1 state if none exists).
async function patchState(page: Page, patch: { mastery?: Record<string, unknown>; settings?: Record<string, unknown> }) {
  await page.evaluate(
    ({ k, patch }) => {
      const empty = { schemaVersion: 1, lessons: {}, exercises: {}, cards: {}, reviews: [], mastery: {}, projects: {}, settings: {} };
      const s = JSON.parse(localStorage.getItem(k) ?? 'null') ?? empty;
      s.mastery = { ...s.mastery, ...patch.mastery };
      s.settings = { ...s.settings, ...patch.settings };
      localStorage.setItem(k, JSON.stringify(s));
    },
    { k: KEY, patch },
  );
}

const masterF0 = (page: Page) =>
  patchState(page, { mastery: { f0: { best: 1, mastered: true, attempts: 1, lastItems: [], updatedAt: new Date().toISOString() } } });

async function fresh(page: Page, url: string) {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function completeWelcome(page: Page) {
  await fresh(page, LESSON);
  await page.getByRole('button', { name: /mark (as )?complete/i }).click();
  await expect.poll(async () => (await readState(page))?.lessons?.[LESSON_ID]?.done).toBe(true);
}

// Answer the first mcq on the welcome lesson (creating an FSRS card), then move its due date into the past.
async function makeOneCardDue(page: Page) {
  await fresh(page, `${LESSON}?quiz=all`);
  const fs = page.locator('fieldset[data-item-id][data-type="mcq"]').first();
  const id = (await fs.getAttribute('data-item-id'))!;
  await fs.getByRole('radio').first().check();
  await fs.getByRole('button', { name: /^check\b/i }).click();
  await expect(fs.locator('[data-feedback]')).toBeVisible();
  await expect.poll(async () => (await readState(page))?.cards?.[id]).toBeTruthy();
  await page.evaluate(
    ({ k, id, due }) => {
      const s = JSON.parse(localStorage.getItem(k)!);
      // Simulate time passing: the review happened days ago, and the card is now due.
      s.cards[id] = { ...s.cards[id], dueAt: due, lastReviewAt: new Date(Date.parse(due) - 3 * 86_400_000).toISOString() };
      localStorage.setItem(k, JSON.stringify(s));
    },
    { k: KEY, id, due: new Date(Date.now() - 2 * DAY).toISOString() },
  );
}

const continueLink = (page: Page) => page.getByRole('link', { name: /continue/i });
const dueCount = (page: Page) => page.locator('[data-due-count]');
const courseProgress = (page: Page, c: string) => page.locator(`[data-course-progress="${c}"]`);
const percent = async (page: Page, c: string) => Number((await courseProgress(page, c).innerText()).match(/(\d+)%/)![1]);
const backupReminder = (page: Page) =>
  page
    .locator('main')
    .locator('div, p, section, aside')
    .filter({ hasText: /back ?up|export/i })
    .filter({ has: page.locator('a[href^="/settings"]') });

test.describe('dashboard /', () => {
  test('is a dashboard with an AI Roadmap / Dashboard heading', async ({ page }) => {
    await fresh(page, '/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/ai roadmap|dashboard/i);
  });

  test('fresh state: Continue opens the first lesson', async ({ page }) => {
    await fresh(page, '/');
    await expect(continueLink(page).first()).toBeVisible();
    await expect(continueLink(page).first()).toHaveAttribute('href', LESSON);
  });

  test('after completing the first lesson, Continue moves on or the dashboard says all caught up', async ({ page }) => {
    await completeWelcome(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/ai roadmap|dashboard/i);
    await expect(page.locator('[data-due-count]')).toBeVisible(); // the dashboard island has rendered
    if (await continueLink(page).count()) {
      const href = await continueLink(page).first().getAttribute('href');
      expect(href).not.toBe(LESSON);
      expect(href).toMatch(/^\/(foundations|mle|research|llm)\/[a-z]\d+\/[\w-]+\/$/);
    } else {
      await expect(page.getByText(/all caught up|nothing to continue|start a track/i).first()).toBeVisible();
    }
  });

  test('reviews due count is 0 on fresh state', async ({ page }) => {
    await fresh(page, '/');
    await expect(dueCount(page)).toHaveText('0');
  });

  test('reviews due count is 1 with one due card and links to /review/', async ({ page }) => {
    await makeOneCardDue(page);
    await page.goto('/');
    await expect(dueCount(page)).toHaveText('1');
    const link = page.locator('a[href="/review/"][data-due-count], a[href="/review/"]:has([data-due-count])');
    await expect(link.first()).toBeVisible();
  });

  test('shows a percentage progress element for each of the four courses', async ({ page }) => {
    await fresh(page, '/');
    for (const c of Object.values(COURSES)) await expect(courseProgress(page, c)).toContainText(/\d+%/);
    await expect(courseProgress(page, 'foundations')).toContainText('0%');
    expect(await percent(page, 'foundations')).toBe(0);
  });

  test('foundations progress rises above 0% after completing a lesson', async ({ page }) => {
    await completeWelcome(page);
    await page.goto('/');
    await expect(courseProgress(page, 'foundations')).toContainText(/\d+%/);
    expect(await percent(page, 'foundations')).toBeGreaterThan(0);
  });

  test('backup reminder shows when the learner has never exported', async ({ page }) => {
    await fresh(page, '/');
    await expect(backupReminder(page).first()).toBeVisible();
  });

  test('backup reminder shows when the last export is older than 7 days', async ({ page }) => {
    await fresh(page, '/');
    await patchState(page, { settings: { lastExportAt: new Date(Date.now() - 10 * DAY).toISOString() } });
    await page.reload();
    await expect(backupReminder(page).first()).toBeVisible();
  });

  test('backup reminder is hidden when the learner exported today', async ({ page }) => {
    await fresh(page, '/');
    await patchState(page, { settings: { lastExportAt: new Date().toISOString() } });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(courseProgress(page, 'foundations')).toBeVisible(); // dashboard hydrated
    await expect(backupReminder(page)).toHaveCount(0);
  });
});

test.describe('roadmap /roadmap/', () => {
  test('has one node per module (51) with a valid status', async ({ page }) => {
    await fresh(page, '/roadmap/');
    await expect(page.locator('[data-module-node]')).toHaveCount(MODULES.length);
    for (const id of MODULES)
      await expect(page.locator(`[data-module-node="${id}"]`)).toHaveAttribute('data-status', /^(mastered|in-progress|available|prereqs-missing)$/);
  });

  test('each node links to its module page', async ({ page }) => {
    await fresh(page, '/roadmap/');
    await expect(page.locator('[data-module-node]')).toHaveCount(MODULES.length);
    const hrefs: Record<string, string | null> = await page.locator('[data-module-node]').evaluateAll((els) =>
      Object.fromEntries(
        els.map((el) => {
          const a = el.closest('a') ?? el.querySelector('a');
          return [el.getAttribute('data-module-node'), a?.getAttribute('href') ?? a?.getAttribute('xlink:href') ?? null];
        }),
      ),
    );
    for (const id of MODULES) expect(hrefs[id], `node ${id}`).toBe(modulePath(id));
  });

  test('fresh state: f0 is available and f1 is missing prerequisites', async ({ page }) => {
    await fresh(page, '/roadmap/');
    await expect(page.locator('[data-module-node="f0"]')).toHaveAttribute('data-status', 'available');
    await expect(page.locator('[data-module-node="f1"]')).toHaveAttribute('data-status', 'prereqs-missing');
  });

  test('after mastering f0: f0 is mastered and f1 is available', async ({ page }) => {
    await fresh(page, '/roadmap/');
    await masterF0(page);
    await page.reload();
    await expect(page.locator('[data-module-node="f0"]')).toHaveAttribute('data-status', 'mastered');
    await expect(page.locator('[data-module-node="f1"]')).toHaveAttribute('data-status', 'available');
  });
});

test.describe('prerequisite banner', () => {
  const banner = (page: Page) => page.locator('[data-prereq-banner]');

  test('f1 without f0 mastered shows a banner naming F0 with a link to it and a Test out link', async ({ page }) => {
    await fresh(page, '/foundations/f1/');
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText(/\bf0\b|setup and how to learn here/i);
    await expect(banner(page).locator('a[href="/foundations/f0/"]').first()).toBeVisible();
    const testOut = banner(page).getByRole('link', { name: /test out/i });
    await expect(testOut).toHaveAttribute('href', '/foundations/f1/check/');
  });

  test('banner disappears once f0 is mastered', async ({ page }) => {
    await fresh(page, '/foundations/f1/');
    await masterF0(page);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });
});

test.describe('capstone /foundations/f11/capstone/', () => {
  const CAPSTONE = '/foundations/f11/capstone/';
  const ID = 'foundations-capstone';

  test('page exists with a rubric checklist and a project status', async ({ page }) => {
    const res = await page.goto(CAPSTONE);
    expect(res?.status()).toBe(200);
    await expect(page.locator('main').getByRole('checkbox').first()).toBeVisible();
    await expect(page.locator('[data-project-status]')).toBeVisible();
  });

  test('ticking every rubric item marks the project passed, and it survives a reload', async ({ page }) => {
    await fresh(page, CAPSTONE);
    const boxes = page.locator('main').getByRole('checkbox');
    await expect(boxes.first()).toBeVisible();
    expect((await readState(page))?.projects?.[ID]?.passed ?? false).toBe(false);
    for (const box of await boxes.all()) await box.check();
    await expect(page.locator('[data-project-status]')).toContainText(/passed|complete/i);
    await expect.poll(async () => (await readState(page))?.projects?.[ID]?.passed).toBe(true);

    await page.reload();
    await expect(page.locator('[data-project-status]')).toContainText(/passed|complete/i);
    for (const box of await boxes.all()) await expect(box).toBeChecked();
  });
});
