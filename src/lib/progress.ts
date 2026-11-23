// Learner progress: one versioned JSON object in localStorage (design §5.4).
// Pure functions + a tiny store that every island shares (they are separate React roots).

export const STORAGE_KEY = 'airoadmap:v1';
const CORRUPT_PREFIX = 'airoadmap:corrupt:';
const REVIEW_TTL_MS = 365 * 86_400_000;

export type Iso = string;
export interface Card {
  dueAt: Date;
  lastReviewAt: Date | null;
  updatedAt: Iso;
  [k: string]: unknown;
}
export interface Review {
  itemId: string;
  grade: 'Again' | 'Good';
  at: Iso;
}
export interface TutorSettings {
  provider: string;
  baseURL: string;
  model: string;
  apiKey?: string;
}
export interface State {
  schemaVersion: 1;
  lessons: Record<string, { done: true; completedAt: Iso; updatedAt: Iso }>;
  exercises: Record<string, { passed: boolean; updatedAt: Iso }>;
  cards: Record<string, Card>;
  reviews: Review[];
  mastery: Record<string, { best: number; mastered: boolean; attempts: number; lastItems: string[]; updatedAt: Iso }>;
  projects: Record<string, { rubricChecked: boolean[]; passed: boolean; updatedAt: Iso }>;
  settings: { tutor?: TutorSettings; lastExportAt?: Iso; lastCourse?: string };
}
export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
export type SaveResult = { ok: true } | { ok: false; error: 'quota' | 'unavailable' | 'corrupt' };

const RECORDS = ['lessons', 'exercises', 'cards', 'mastery', 'projects'] as const;
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function emptyState(): State {
  return { schemaVersion: 1, lessons: {}, exercises: {}, cards: {}, reviews: [], mastery: {}, projects: {}, settings: {} };
}

// Accepts anything; keeps the parts that have the right shape. Future schema versions add steps here.
const isIso = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isDateLike = (v: unknown) => v instanceof Date || isIso(v);
// Per-entry shape checks: malformed entries are dropped instead of being merged/saved.
const VALID: Record<(typeof RECORDS)[number], (v: any) => boolean> = {
  lessons: (v) => isObj(v) && v.done === true && isIso(v.completedAt) && isIso(v.updatedAt),
  exercises: (v) => isObj(v) && typeof v.passed === 'boolean' && isIso(v.updatedAt),
  cards: (v) => isObj(v) && isDateLike(v.dueAt) && (v.lastReviewAt == null || isDateLike(v.lastReviewAt)) && isIso(v.updatedAt),
  mastery: (v) => isObj(v) && typeof v.best === 'number' && typeof v.mastered === 'boolean' && typeof v.attempts === 'number' && Array.isArray(v.lastItems) && isIso(v.updatedAt),
  projects: (v) => isObj(v) && Array.isArray(v.rubricChecked) && typeof v.passed === 'boolean' && isIso(v.updatedAt),
};

export function migrate(raw: unknown): State {
  const s = emptyState();
  if (!isObj(raw)) return s;
  for (const k of RECORDS)
    if (isObj(raw[k])) (s as any)[k] = Object.fromEntries(Object.entries(raw[k]).filter(([, v]) => VALID[k](v)));
  if (Array.isArray(raw.reviews)) s.reviews = raw.reviews.filter((r: any) => isObj(r) && typeof r.itemId === 'string' && isIso(r.at) && (r.grade === 'Again' || r.grade === 'Good'));
  if (isObj(raw.settings)) s.settings = { ...raw.settings };
  return s;
}

const reviveCards = (s: State): State => {
  for (const [id, c] of Object.entries(s.cards)) {
    s.cards[id] = { ...c, dueAt: new Date(c.dueAt as any), lastReviewAt: c.lastReviewAt == null ? null : new Date(c.lastReviewAt as any) };
  }
  return s;
};

export function load(storage: StorageLike, now = new Date()): { state: State; corrupt: boolean } {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw == null) return { state: emptyState(), corrupt: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Keep the original untouched and copy it aside (one copy per distinct content).
    // Saving stays blocked until the learner confirms a reset (createStore.resetCorrupt).
    try {
      storage.setItem(CORRUPT_PREFIX + hash(raw), raw);
    } catch {}
    return { state: emptyState(), corrupt: true };
  }
  // A newer schema than this build understands: read what we can, but never overwrite it.
  if (isObj(parsed) && typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > 1)
    return { state: reviveCards(migrate(parsed)), corrupt: true };
  return { state: reviveCards(migrate(parsed)), corrupt: false };
}

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

export function compact(state: State, now: Date): State {
  const cutoff = now.getTime() - REVIEW_TTL_MS;
  return { ...state, reviews: state.reviews.filter((r) => Date.parse(r.at) >= cutoff) };
}

export function save(storage: StorageLike, state: State, now = new Date()): SaveResult {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(compact(state, now)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.name === 'QuotaExceededError' ? 'quota' : 'unavailable' };
  }
}

export function markLessonDone(state: State, lessonId: string, now: Date): State {
  const at = now.toISOString();
  return { ...state, lessons: { ...state.lessons, [lessonId]: { done: true, completedAt: at, updatedAt: at } } };
}

export function recordExercise(state: State, id: string, passed: boolean, now: Date): State {
  const prev = state.exercises[id]?.passed ?? false;
  return { ...state, exercises: { ...state.exercises, [id]: { passed: prev || passed, updatedAt: now.toISOString() } } };
}

export function exportState(state: State, now: Date): string {
  const tutor = state.settings.tutor ? (({ apiKey, ...rest }) => rest)(state.settings.tutor) : undefined;
  return JSON.stringify({ ...state, settings: { ...state.settings, tutor }, exportedAt: now.toISOString() }, null, 2);
}

export function parseImport(text: string): State {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON, so it could not be imported.');
  }
  if (!isObj(raw) || raw.schemaVersion !== 1) throw new Error('This file is not an AI Roadmap progress export (missing schemaVersion 1).');
  for (const k of RECORDS) if (k in raw && !isObj(raw[k])) throw new Error(`Invalid progress file: "${k}" must be an object.`);
  if ('reviews' in raw && !Array.isArray(raw.reviews)) throw new Error('Invalid progress file: "reviews" must be a list.');
  return reviveCards(migrate(raw));
}

const newer = <T extends { updatedAt: Iso }>(a: T | undefined, b: T | undefined) =>
  !a ? b! : !b ? a : Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;

export function mergeImport(current: State, incoming: State): State {
  const out: State = { ...current };
  for (const k of RECORDS) {
    const merged: Record<string, any> = { ...current[k] };
    for (const [id, rec] of Object.entries(incoming[k])) merged[id] = newer(merged[id], rec as any);
    (out as any)[k] = merged;
  }
  const seen = new Set(current.reviews.map((r) => `${r.itemId}@${r.at}`));
  out.reviews = [...current.reviews, ...incoming.reviews.filter((r) => !seen.has(`${r.itemId}@${r.at}`))];
  out.settings = current.settings;
  return out;
}

export function createStore(storage: StorageLike, now: () => Date = () => new Date()) {
  const loaded = load(storage, now());
  let state = loaded.state;
  const subs = new Set<(s: State) => void>();
  const notify = () => subs.forEach((cb) => cb(state));
  const store = {
    corrupt: loaded.corrupt,
    get: () => state,
    /** Re-reads storage before applying fn, so another tab's writes are never clobbered.
     *  Subscribers are notified only when the save succeeded. */
    update(fn: (s: State) => State): SaveResult {
      if (store.corrupt) return { ok: false, error: 'corrupt' };
      const fresh = load(storage, now());
      if (fresh.corrupt) {
        store.corrupt = true;
        return { ok: false, error: 'corrupt' };
      }
      const next = fn(fresh.state);
      const result = save(storage, next, now());
      if (result.ok) {
        state = next;
        notify();
      }
      return result;
    },
    /** Pick up writes made elsewhere (another tab). */
    refresh() {
      const fresh = load(storage, now());
      if (!fresh.corrupt) {
        state = fresh.state;
        notify();
      }
    },
    /** The learner confirmed: discard unreadable saved progress (a copy was kept aside). */
    resetCorrupt() {
      store.corrupt = false;
      state = emptyState();
      const result = save(storage, state, now());
      notify();
      return result;
    },
    subscribe(cb: (s: State) => void) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
  };
  return store;
}

// Browser singleton shared by every island on the page.
let browserStore: ReturnType<typeof createStore> | undefined;
export function progress() {
  if (!browserStore) {
    const store = createStore(window.localStorage);
    browserStore = store;
    window.addEventListener('storage', (e) => e.key === STORAGE_KEY && store.refresh());
    // Ask the browser not to evict our storage on the first real interaction; harmless if denied.
    const ask = () => navigator.storage?.persist?.().catch(() => {});
    window.addEventListener('pointerdown', ask, { once: true });
    window.addEventListener('keydown', ask, { once: true });
  }
  return browserStore;
}
