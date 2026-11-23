import { describe, it, expect } from 'vitest';
import {
  STORAGE_KEY,
  emptyState,
  migrate,
  load,
  save,
  compact,
  markLessonDone,
  recordExercise,
  exportState,
  parseImport,
  mergeImport,
  createStore,
  type State,
  type StorageLike,
} from '@/lib/progress';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function memStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function fullStorage(): StorageLike {
  const s = memStorage();
  return {
    ...s,
    setItem: () => {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    },
  };
}

function sample(): State {
  const s = emptyState();
  s.lessons['foundations/f0/welcome'] = { done: true, completedAt: ago(1), updatedAt: ago(1) };
  s.exercises['f0-ex1'] = { passed: true, updatedAt: ago(1) };
  s.cards['f0-q1'] = { dueAt: new Date('2026-06-05T00:00:00.000Z'), lastReviewAt: new Date('2026-05-30T00:00:00.000Z'), stability: 2.5, updatedAt: ago(2) };
  s.cards['f0-q2'] = { dueAt: new Date('2026-06-02T00:00:00.000Z'), lastReviewAt: null, updatedAt: ago(2) };
  s.reviews.push({ itemId: 'f0-q1', grade: 'Good', at: ago(2) });
  s.mastery['f0'] = { best: 0.8, mastered: false, attempts: 1, lastItems: ['f0-q1'], updatedAt: ago(1) };
  s.projects['p1'] = { rubricChecked: [true, false], passed: false, updatedAt: ago(1) };
  s.settings.tutor = { provider: 'openai', baseURL: 'https://api.example.com/v1', model: 'gpt-x', apiKey: 'sk-secret' };
  return s;
}

function expectValidEmptyish(s: State) {
  expect(s.schemaVersion).toBe(1);
  for (const k of ['lessons', 'exercises', 'cards', 'mastery', 'projects', 'settings'] as const) {
    expect(s[k]).toBeTypeOf('object');
    expect(s[k]).not.toBeNull();
    expect(Array.isArray(s[k])).toBe(false);
  }
  expect(Array.isArray(s.reviews)).toBe(true);
}

describe('save/load', () => {
  it('round-trips state and revives card dates', () => {
    const storage = memStorage();
    const state = sample();
    expect(save(storage, state, NOW)).toEqual({ ok: true });
    const { state: loaded, corrupt } = load(storage, NOW);
    expect(corrupt).toBe(false);
    expect(loaded).toEqual(state);
    const card = loaded.cards['f0-q1'];
    expect(card.dueAt).toBeInstanceOf(Date);
    expect(card.dueAt.getTime()).toBe(state.cards['f0-q1'].dueAt.getTime());
    expect(card.lastReviewAt).toBeInstanceOf(Date);
    expect(card.lastReviewAt!.getTime()).toBe(state.cards['f0-q1'].lastReviewAt!.getTime());
    expect(loaded.cards['f0-q2'].lastReviewAt).toBeNull();
  });

  it('writes under STORAGE_KEY', () => {
    const storage = memStorage();
    save(storage, sample(), NOW);
    expect(STORAGE_KEY).toBe('airoadmap:v1');
    expect(storage.data.get(STORAGE_KEY)).toContain('foundations/f0/welcome');
  });

  it('loads an empty state from empty storage', () => {
    const { state, corrupt } = load(memStorage(), NOW);
    expect(corrupt).toBe(false);
    expect(state).toEqual(emptyState());
  });

  it('flags corrupt JSON, backs up the raw string, and leaves STORAGE_KEY untouched', () => {
    const storage = memStorage();
    const raw = '{"schemaVersion":1, lessons: oops';
    storage.setItem(STORAGE_KEY, raw);
    const { state, corrupt } = load(storage, NOW);
    expect(corrupt).toBe(true);
    expect(state).toEqual(emptyState());
    const backups = [...storage.data.keys()].filter((k) => k.startsWith('airoadmap:corrupt:'));
    expect(backups).toHaveLength(1);
    expect(storage.data.get(backups[0])).toBe(raw);
    expect(storage.data.get(STORAGE_KEY)).toBe(raw);
  });

  it('returns a quota error instead of throwing when storage is full', () => {
    let result: ReturnType<typeof save> | undefined;
    expect(() => (result = save(fullStorage(), sample(), NOW))).not.toThrow();
    expect(result).toEqual({ ok: false, error: 'quota' });
  });

  it('compacts old reviews when saving', () => {
    const storage = memStorage();
    const s = emptyState();
    s.reviews.push({ itemId: 'old', grade: 'Again', at: ago(400) }, { itemId: 'new', grade: 'Good', at: ago(1) });
    save(storage, s, NOW);
    expect(load(storage, NOW).state.reviews.map((r) => r.itemId)).toEqual(['new']);
  });
});

describe('migrate', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty object', {}],
    ['unknown version with garbage fields', { schemaVersion: 99, lessons: 'x' }],
    ['a string', 'hello'],
    ['an array', [1, 2]],
  ])('fills defaults for %s without throwing', (_name, raw) => {
    expectValidEmptyish(migrate(raw));
  });

  it('keeps valid lesson records', () => {
    const s = migrate({ schemaVersion: 1, lessons: { a: { done: true, completedAt: ago(1), updatedAt: ago(1) } } });
    expect(s.lessons.a.done).toBe(true);
    expectValidEmptyish(s);
  });
});

describe('compact', () => {
  it('drops reviews older than 365 days and keeps a 364-day-old one', () => {
    const s = emptyState();
    s.reviews.push(
      { itemId: 'ancient', grade: 'Good', at: ago(366) },
      { itemId: 'recent', grade: 'Again', at: ago(364) },
    );
    expect(compact(s, NOW).reviews.map((r) => r.itemId)).toEqual(['recent']);
  });
});

describe('markLessonDone', () => {
  it('sets the lesson record without mutating the input', () => {
    const before = emptyState();
    const after = markLessonDone(before, 'foundations/f0/welcome', NOW);
    expect(after.lessons['foundations/f0/welcome']).toMatchObject({ done: true, completedAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(before.lessons).toEqual({});
    expect(after).not.toBe(before);
  });
});

describe('recordExercise', () => {
  it('records a pass', () => {
    expect(recordExercise(emptyState(), 'ex', true, NOW).exercises.ex.passed).toBe(true);
  });

  it('keeps passed sticky once true', () => {
    const s = recordExercise(recordExercise(emptyState(), 'ex', true, NOW), 'ex', false, new Date(NOW.getTime() + 1000));
    expect(s.exercises.ex.passed).toBe(true);
  });

  it('records a failure when never passed', () => {
    expect(recordExercise(emptyState(), 'ex', false, NOW).exercises.ex.passed).toBe(false);
  });
});

describe('exportState / parseImport', () => {
  it('strips the tutor apiKey but keeps provider, baseURL and model', () => {
    const text = exportState(sample(), NOW);
    expect(text).not.toContain('sk-secret');
    const json = JSON.parse(text);
    expect(json.settings.tutor).toEqual({ provider: 'openai', baseURL: 'https://api.example.com/v1', model: 'gpt-x' });
    expect(json.exportedAt).toBe(NOW.toISOString());
  });

  it('does not mutate the source state when stripping apiKey', () => {
    const s = sample();
    exportState(s, NOW);
    expect(s.settings.tutor?.apiKey).toBe('sk-secret');
  });

  it('produces output that parseImport accepts, with dates revived', () => {
    const imported = parseImport(exportState(sample(), NOW));
    expect(imported.schemaVersion).toBe(1);
    expect(imported.lessons['foundations/f0/welcome'].done).toBe(true);
    expect(imported.cards['f0-q1'].dueAt).toBeInstanceOf(Date);
  });

  it('throws a readable error on invalid JSON', () => {
    expect(() => parseImport('not json')).toThrow(Error);
    expect(() => parseImport('not json')).toThrow(/\w{3,}/);
  });

  it('throws on JSON with the wrong shape', () => {
    expect(() => parseImport('{"foo":1}')).toThrow(Error);
  });

  it('throws when lessons is not an object', () => {
    expect(() => parseImport('{"schemaVersion":1,"lessons":"x"}')).toThrow(Error);
  });

  it('throws on an empty string', () => {
    expect(() => parseImport('')).toThrow(Error);
  });
});

describe('mergeImport', () => {
  const lesson = (at: string) => ({ done: true as const, completedAt: at, updatedAt: at });

  it('takes the incoming lesson record when it is newer', () => {
    const current = emptyState();
    current.lessons.a = lesson(ago(5));
    const incoming = emptyState();
    incoming.lessons.a = lesson(ago(1));
    expect(mergeImport(current, incoming).lessons.a.updatedAt).toBe(ago(1));
  });

  it('keeps the current lesson record when it is newer', () => {
    const current = emptyState();
    current.lessons.a = lesson(ago(1));
    const incoming = emptyState();
    incoming.lessons.a = lesson(ago(5));
    expect(mergeImport(current, incoming).lessons.a.updatedAt).toBe(ago(1));
  });

  it('keeps records that exist on only one side', () => {
    const current = emptyState();
    current.lessons.mine = lesson(ago(1));
    current.exercises.e1 = { passed: true, updatedAt: ago(1) };
    const incoming = emptyState();
    incoming.lessons.theirs = lesson(ago(2));
    incoming.projects.p = { rubricChecked: [true], passed: true, updatedAt: ago(2) };
    const merged = mergeImport(current, incoming);
    expect(Object.keys(merged.lessons).sort()).toEqual(['mine', 'theirs']);
    expect(merged.exercises.e1.passed).toBe(true);
    expect(merged.projects.p.passed).toBe(true);
  });

  it('unions reviews and de-duplicates identical itemId+at', () => {
    const current = emptyState();
    current.reviews.push({ itemId: 'q1', grade: 'Good', at: ago(3) }, { itemId: 'q2', grade: 'Again', at: ago(2) });
    const incoming = emptyState();
    incoming.reviews.push({ itemId: 'q1', grade: 'Good', at: ago(3) }, { itemId: 'q3', grade: 'Good', at: ago(1) });
    const keys = mergeImport(current, incoming).reviews.map((r) => `${r.itemId}@${r.at}`).sort();
    expect(keys).toEqual([`q1@${ago(3)}`, `q2@${ago(2)}`, `q3@${ago(1)}`].sort());
  });

  it('keeps the same item reviewed at different times', () => {
    const current = emptyState();
    current.reviews.push({ itemId: 'q1', grade: 'Good', at: ago(3) });
    const incoming = emptyState();
    incoming.reviews.push({ itemId: 'q1', grade: 'Again', at: ago(1) });
    expect(mergeImport(current, incoming).reviews).toHaveLength(2);
  });

  it('keeps current settings and ignores incoming ones', () => {
    const current = emptyState();
    current.settings = { tutor: { provider: 'local', baseURL: 'http://localhost:11434', model: 'llama', apiKey: 'k' }, lastCourse: 'llm' };
    const incoming = emptyState();
    incoming.settings = { tutor: { provider: 'openai', baseURL: 'https://x', model: 'y' }, lastCourse: 'mle' };
    expect(mergeImport(current, incoming).settings).toEqual(current.settings);
  });
});

describe('createStore', () => {
  it('starts from what is in storage', () => {
    const storage = memStorage();
    save(storage, sample(), NOW);
    const store = createStore(storage, () => NOW);
    expect(store.corrupt).toBe(false);
    expect(store.get().lessons['foundations/f0/welcome'].done).toBe(true);
  });

  it('reports corrupt storage', () => {
    const storage = memStorage();
    storage.setItem(STORAGE_KEY, '{{{');
    expect(createStore(storage, () => NOW).corrupt).toBe(true);
  });

  it('update notifies subscribers with the new state and persists it', () => {
    const storage = memStorage();
    const store = createStore(storage, () => NOW);
    const seen: State[] = [];
    store.subscribe((s) => seen.push(s));
    expect(store.update((s) => markLessonDone(s, 'foundations/f0/welcome', NOW))).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].lessons['foundations/f0/welcome'].done).toBe(true);
    expect(store.get().lessons['foundations/f0/welcome'].done).toBe(true);
    expect(load(storage, NOW).state.lessons['foundations/f0/welcome'].done).toBe(true);
  });

  it('unsubscribe stops notifications', () => {
    const store = createStore(memStorage(), () => NOW);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.update((s) => markLessonDone(s, 'a', NOW));
    off();
    store.update((s) => markLessonDone(s, 'b', NOW));
    expect(calls).toBe(1);
  });

  it('update returns a quota error without throwing when storage is full', () => {
    const store = createStore(fullStorage(), () => NOW);
    expect(store.update((s) => markLessonDone(s, 'a', NOW))).toEqual({ ok: false, error: 'quota' });
  });
});
