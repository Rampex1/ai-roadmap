import { describe, it, expect, beforeAll } from 'vitest';
import { emptyState, type State } from '@/lib/progress';
import { getScheduler, applyAnswer, dueItems, retrievability } from '@/lib/srs';

type Scheduler = Awaited<ReturnType<typeof getScheduler>>;
let s: Scheduler;
beforeAll(async () => {
  s = await getScheduler();
});

// Local-time dates so "same calendar day" is unambiguous in any TZ.
const day = (d: number, h = 9, m = 0) => new Date(2026, 0, d, h, m);
const card = (dueAt: Date) => ({ dueAt, lastReviewAt: null, updatedAt: dueAt.toISOString() });

describe('getScheduler', () => {
  it('returns the same cached scheduler on repeated calls', async () => {
    expect(await getScheduler()).toBe(s);
  });
});

describe('applyAnswer', () => {
  it('creates a card on the first correct answer and logs a Good review', () => {
    const now = day(10);
    const next = applyAnswer(s, emptyState(), 'q1', true, now);
    expect(Object.keys(next.cards)).toEqual(['q1']);
    expect(next.cards.q1.updatedAt).toBe(now.toISOString());
    expect(next.cards.q1.lastReviewAt?.getTime()).toBe(now.getTime());
    expect(next.cards.q1.dueAt.getTime()).toBeGreaterThan(now.getTime());
    expect(next.cards.q1.reps).toBe(1);
    expect(next.reviews).toEqual([{ itemId: 'q1', grade: 'Good', at: now.toISOString() }]);
  });

  it('creates a card on the first wrong answer and logs an Again review', () => {
    const now = day(10);
    const next = applyAnswer(s, emptyState(), 'q1', false, now);
    expect(next.cards.q1).toBeDefined();
    expect(next.reviews).toEqual([{ itemId: 'q1', grade: 'Again', at: now.toISOString() }]);
  });

  it('schedules a wrong answer sooner than a right one', () => {
    const now = day(10);
    const wrong = applyAnswer(s, emptyState(), 'q1', false, now).cards.q1.dueAt.getTime();
    const right = applyAnswer(s, emptyState(), 'q1', true, now).cards.q1.dueAt.getTime();
    expect(wrong).toBeLessThan(right);
  });

  it('does not mutate the input state', () => {
    const state = emptyState();
    const snapshot = structuredClone(state);
    applyAnswer(s, state, 'q1', true, day(10));
    expect(state).toEqual(snapshot);
    const once = applyAnswer(s, state, 'q1', true, day(10));
    const onceSnap = structuredClone(once);
    applyAnswer(s, once, 'q1', false, day(20));
    expect(once).toEqual(onceSnap);
  });

  it('ignores a second answer on the same local day and returns the same object', () => {
    const first = applyAnswer(s, emptyState(), 'q1', true, day(10, 9));
    const second = applyAnswer(s, first, 'q1', false, day(10, 22));
    expect(second).toBe(first);
    expect(second.reviews).toHaveLength(1);
  });

  it('counts an answer on the next local day (just after midnight)', () => {
    const first = applyAnswer(s, emptyState(), 'q1', true, day(10, 23, 30));
    const second = applyAnswer(s, first, 'q1', true, day(11, 0, 30));
    expect(second).not.toBe(first);
    expect(second.reviews).toHaveLength(2);
    expect(second.cards.q1.reps).toBe(2);
    expect(second.cards.q1.updatedAt).toBe(day(11, 0, 30).toISOString());
  });

  it('reviews the existing card rather than recreating it on later answers', () => {
    let st = applyAnswer(s, emptyState(), 'q1', true, day(1));
    st = applyAnswer(s, st, 'q1', true, day(5));
    st = applyAnswer(s, st, 'q1', true, day(20));
    expect(st.cards.q1.reps).toBe(3);
    expect(st.reviews.map((r) => r.grade)).toEqual(['Good', 'Good', 'Good']);
  });

  it('records a lapse when a learned card is answered wrong later', () => {
    let st = applyAnswer(s, emptyState(), 'q1', true, day(1));
    st = applyAnswer(s, st, 'q1', true, day(5));
    st = applyAnswer(s, st, 'q1', false, day(30));
    expect(st.cards.q1.lapses).toBe(1);
    expect(st.reviews.at(-1)).toEqual({ itemId: 'q1', grade: 'Again', at: day(30).toISOString() });
  });

  it('keeps other items’ cards and reviews intact', () => {
    let st = applyAnswer(s, emptyState(), 'a', true, day(1));
    const aCard = st.cards.a;
    st = applyAnswer(s, st, 'b', false, day(1));
    expect(st.cards.a).toEqual(aCard);
    expect(st.reviews.map((r) => r.itemId)).toEqual(['a', 'b']);
  });
});

describe('dueItems', () => {
  const now = day(10, 12);

  it('returns an empty list when there are no cards', () => {
    expect(dueItems(emptyState(), now)).toEqual([]);
  });

  it('returns due items earliest first and excludes future ones', () => {
    const state: State = {
      ...emptyState(),
      cards: {
        late: card(day(9)) as any,
        future: card(day(11)) as any,
        earliest: card(day(2)) as any,
        mid: card(day(5)) as any,
      },
    };
    expect(dueItems(state, now)).toEqual(['earliest', 'mid', 'late']);
  });

  it('includes an item due exactly now', () => {
    const state: State = { ...emptyState(), cards: { exact: card(now) as any, soon: card(new Date(now.getTime() + 1)) as any } };
    expect(dueItems(state, now)).toEqual(['exact']);
  });

  it('works with cards produced by applyAnswer', () => {
    const st = applyAnswer(s, emptyState(), 'q1', false, day(1));
    expect(dueItems(st, day(1))).toEqual([]);
    expect(dueItems(st, day(300))).toEqual(['q1']);
  });
});

describe('retrievability', () => {
  it('is 0 when there is no card', () => {
    expect(retrievability(s, undefined, day(10))).toBe(0);
  });

  it('is within [0,1] for a reviewed card', () => {
    const c = applyAnswer(s, emptyState(), 'q1', true, day(1)).cards.q1;
    for (const t of [day(1), day(2), day(30), new Date(2030, 0, 1)]) {
      const r = retrievability(s, c, t);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('is lower long after the review than right after it', () => {
    const c = applyAnswer(s, emptyState(), 'q1', true, day(1)).cards.q1;
    const soon = retrievability(s, c, day(1, 10));
    const later = retrievability(s, c, new Date(2027, 6, 1));
    expect(soon).toBeGreaterThan(0.8);
    expect(later).toBeLessThan(soon);
  });
});

describe('dueItems review fixes', () => {
  it('skips a card already reviewed today even when its learning step is due', async () => {
    const { getScheduler, applyAnswer, dueItems } = await import('@/lib/srs');
    const { emptyState } = await import('@/lib/progress');
    const s = await getScheduler();
    const morning = new Date(2026, 5, 1, 9, 0);
    const st = applyAnswer(s, emptyState(), 'q', false, morning);
    expect(dueItems(st, new Date(2026, 5, 1, 18, 0))).toEqual([]);
    expect(dueItems(st, new Date(2026, 5, 2, 9, 0))).toEqual(['q']);
  });
  it('ignores cards whose item is not in the known set', async () => {
    const { getScheduler, applyAnswer, dueItems } = await import('@/lib/srs');
    const { emptyState } = await import('@/lib/progress');
    const s = await getScheduler();
    const st = applyAnswer(s, emptyState(), 'gone', false, new Date(2026, 5, 1, 9, 0));
    expect(dueItems(st, new Date(2026, 5, 3), new Set(['other']))).toEqual([]);
  });
});
