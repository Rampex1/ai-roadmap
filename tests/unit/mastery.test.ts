import { describe, it, expect } from 'vitest';
import { emptyState } from '@/lib/progress';
import { CHECK_SIZE, PASS_MARK, pickCheckItems, scoreCheck, recordCheck } from '@/lib/mastery';

const POOL = [
  { id: 'a1', lesson: 'A' },
  { id: 'a2', lesson: 'A' },
  { id: 'a3', lesson: 'A' },
  { id: 'b1', lesson: 'B' },
  { id: 'b2', lesson: 'B' },
];
const zero = () => 0;
const unique = (xs: string[]) => new Set(xs).size === xs.length;

describe('constants', () => {
  it('uses a 12-item check with an 80% pass mark', () => {
    expect(CHECK_SIZE).toBe(12);
    expect(PASS_MARK).toBe(0.8);
  });
});

describe('pickCheckItems', () => {
  it('returns an empty list for an empty pool', () => {
    expect(pickCheckItems([], [], zero, 4)).toEqual([]);
  });

  it('takes items round-robin across lessons in first-appearance order', () => {
    expect(pickCheckItems(POOL, [], zero, 4)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('orders lessons by first appearance in the pool, not alphabetically', () => {
    const pool = [{ id: 'b1', lesson: 'B' }, { id: 'a1', lesson: 'A' }, { id: 'b2', lesson: 'B' }];
    expect(pickCheckItems(pool, [], zero, 3)).toEqual(['b1', 'a1', 'b2']);
  });

  it('picks lowest-retrievability items first within each lesson', () => {
    const r: Record<string, number> = { a1: 0.9, a2: 0.1, a3: 0.5, b1: 0.7, b2: 0.2 };
    expect(pickCheckItems(POOL, [], (id) => r[id], 5)).toEqual(['a2', 'b2', 'a3', 'b1', 'a1']);
  });

  it('breaks retrievability ties by id', () => {
    const pool = [{ id: 'z', lesson: 'L' }, { id: 'm', lesson: 'L' }, { id: 'c', lesson: 'L' }];
    expect(pickCheckItems(pool, [], () => 0.5, 3)).toEqual(['c', 'm', 'z']);
  });

  it('excludes last-attempt items when enough others remain', () => {
    const got = pickCheckItems(POOL, ['a1'], zero, 4);
    expect(got).toEqual(['a2', 'b1', 'a3', 'b2']);
  });

  it('allows last-attempt items back when too few others remain, preferring non-last ones', () => {
    const got = pickCheckItems(POOL, ['a1', 'b1'], zero, 4);
    expect(got).toHaveLength(4);
    expect(unique(got)).toBe(true);
    expect(got).toEqual(expect.arrayContaining(['a2', 'a3', 'b2']));
    expect(got.filter((id) => id === 'a1' || id === 'b1')).toHaveLength(1);
  });

  it('returns the whole pool without duplicates when n exceeds the pool size', () => {
    const got = pickCheckItems(POOL, [], zero, 50);
    expect(got).toHaveLength(5);
    expect(unique(got)).toBe(true);
    expect([...got].sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
  });

  it('returns the whole pool even when every item was in the last attempt', () => {
    const got = pickCheckItems(POOL, POOL.map((p) => p.id), zero, 50);
    expect([...got].sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
  });

  it('defaults to CHECK_SIZE items', () => {
    const pool = Array.from({ length: 30 }, (_, i) => ({ id: `q${String(i).padStart(2, '0')}`, lesson: `L${i % 3}` }));
    const got = pickCheckItems(pool, [], zero);
    expect(got).toHaveLength(CHECK_SIZE);
    expect(unique(got)).toBe(true);
  });

  it('ignores lastItems that are not in the pool', () => {
    expect(pickCheckItems(POOL, ['ghost'], zero, 4)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });
});

describe('scoreCheck', () => {
  it('passes at exactly 80% (8/10)', () => {
    expect(scoreCheck(8, 10)).toEqual({ score: 0.8, passed: true });
  });
  it('fails just under 80% (79/100)', () => {
    expect(scoreCheck(79, 100)).toEqual({ score: 0.79, passed: false });
  });
  it('treats 0/0 as score 0, not passed', () => {
    expect(scoreCheck(0, 0)).toEqual({ score: 0, passed: false });
  });
  it('passes a perfect score', () => {
    expect(scoreCheck(12, 12)).toEqual({ score: 1, passed: true });
  });
  it('fails 0 correct', () => {
    expect(scoreCheck(0, 12)).toEqual({ score: 0, passed: false });
  });
});

describe('recordCheck', () => {
  const t1 = new Date('2026-01-01T10:00:00Z');
  const t2 = new Date('2026-01-02T10:00:00Z');

  it('records a first attempt', () => {
    const st = recordCheck(emptyState(), 'm1', ['a', 'b'], 1, t1);
    expect(st.mastery.m1).toEqual({ best: 0.5, mastered: false, attempts: 1, lastItems: ['a', 'b'], updatedAt: t1.toISOString() });
  });

  it('marks mastered on a passing attempt', () => {
    const st = recordCheck(emptyState(), 'm1', ['a', 'b', 'c', 'd', 'e'], 4, t1);
    expect(st.mastery.m1.mastered).toBe(true);
    expect(st.mastery.m1.best).toBe(0.8);
  });

  it('keeps the best score, counts attempts and updates lastItems/updatedAt', () => {
    let st = recordCheck(emptyState(), 'm1', ['a', 'b', 'c', 'd'], 3, t1);
    st = recordCheck(st, 'm1', ['e', 'f', 'g', 'h'], 1, t2);
    expect(st.mastery.m1).toEqual({ best: 0.75, mastered: false, attempts: 2, lastItems: ['e', 'f', 'g', 'h'], updatedAt: t2.toISOString() });
  });

  it('keeps mastered true after a later failing attempt', () => {
    let st = recordCheck(emptyState(), 'm1', ['a'], 1, t1);
    st = recordCheck(st, 'm1', ['b'], 0, t2);
    expect(st.mastery.m1.mastered).toBe(true);
    expect(st.mastery.m1.best).toBe(1);
    expect(st.mastery.m1.attempts).toBe(2);
  });

  it('does not touch other modules', () => {
    const a = recordCheck(emptyState(), 'm1', ['a'], 1, t1);
    const b = recordCheck(a, 'm2', ['b'], 0, t2);
    expect(b.mastery.m1).toEqual(a.mastery.m1);
  });

  it('does not mutate the input state', () => {
    const st = recordCheck(emptyState(), 'm1', ['a'], 0, t1);
    const snap = structuredClone(st);
    recordCheck(st, 'm1', ['b'], 1, t2);
    expect(st).toEqual(snap);
  });
});
