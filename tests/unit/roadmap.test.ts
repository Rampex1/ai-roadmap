import { describe, it, expect } from 'vitest';
import { emptyState, type State } from '@/lib/progress';
import { layers, moduleStatus, type ModuleNode } from '@/lib/roadmap';

const mod = (id: string, prereqs: string[] = [], order = 0, course = 'foundations'): ModuleNode => ({ id, course, order, prereqs });
const mastered = (...ids: string[]): State => ({
  ...emptyState(),
  mastery: Object.fromEntries(ids.map((id) => [id, { best: 1, mastered: true, attempts: 1, lastItems: [], updatedAt: '2026-01-01T00:00:00.000Z' }])),
});

describe('layers', () => {
  it('returns an empty map for no modules', () => {
    expect(layers([])).toEqual({});
  });

  it('puts modules without prereqs at layer 0', () => {
    expect(layers([mod('a'), mod('b')])).toEqual({ a: 0, b: 0 });
  });

  it('computes 1 + max prereq layer on a diamond', () => {
    const ms = [mod('d', ['b', 'c']), mod('b', ['a']), mod('c', ['a']), mod('a')];
    expect(layers(ms)).toEqual({ a: 0, b: 1, c: 1, d: 2 });
  });

  it('uses the deepest prereq when branches differ in length', () => {
    const ms = [mod('a'), mod('b', ['a']), mod('c', ['b']), mod('d', ['a', 'c'])];
    expect(layers(ms).d).toBe(3);
  });

  it('ignores prereqs pointing at unknown ids', () => {
    expect(layers([mod('a', ['ghost']), mod('b', ['a', 'ghost'])])).toEqual({ a: 0, b: 1 });
  });

  it('throws on a cycle', () => {
    expect(() => layers([mod('a', ['c']), mod('b', ['a']), mod('c', ['b'])])).toThrow(/cycle/i);
  });

  it('throws on a self-loop', () => {
    expect(() => layers([mod('a', ['a'])])).toThrow(/cycle/i);
  });
});

describe('moduleStatus', () => {
  it('is mastered when the module is mastered', () => {
    expect(moduleStatus(mod('m', ['p']), mastered('m'), 3, 3)).toBe('mastered');
  });

  it('is mastered even if prereqs are not mastered and no lessons are done', () => {
    expect(moduleStatus(mod('m', ['p']), mastered('m'), 3, 0)).toBe('mastered');
  });

  it('is in-progress when some lessons are done and not mastered', () => {
    expect(moduleStatus(mod('m'), emptyState(), 3, 1)).toBe('in-progress');
  });

  it('is in-progress even when prereqs are missing', () => {
    expect(moduleStatus(mod('m', ['p']), emptyState(), 3, 2)).toBe('in-progress');
  });

  it('is available with no prereqs and no lessons done', () => {
    expect(moduleStatus(mod('m'), emptyState(), 3, 0)).toBe('available');
  });

  it('is available when every prereq is mastered', () => {
    expect(moduleStatus(mod('m', ['p', 'q']), mastered('p', 'q'), 3, 0)).toBe('available');
  });

  it('is prereqs-missing when any prereq is not mastered', () => {
    expect(moduleStatus(mod('m', ['p', 'q']), mastered('p'), 3, 0)).toBe('prereqs-missing');
  });

  it('treats a prereq with mastery record but mastered=false as missing', () => {
    const st: State = { ...emptyState(), mastery: { p: { best: 0.5, mastered: false, attempts: 2, lastItems: [], updatedAt: '2026-01-01T00:00:00.000Z' } } };
    expect(moduleStatus(mod('m', ['p']), st, 3, 0)).toBe('prereqs-missing');
  });
});
