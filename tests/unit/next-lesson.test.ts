import { describe, it, expect } from 'vitest';
import { emptyState, type State } from '@/lib/progress';
import { nextLesson, type LessonRef } from '@/lib/next-lesson';
import type { ModuleNode } from '@/lib/roadmap';

const AT = '2026-01-01T00:00:00.000Z';
const mod = (id: string, course: string, order: number, prereqs: string[] = []): ModuleNode => ({ id, course, order, prereqs });

// foundations: f1 (L0, order 1), f4 (L0, order 5), f3 (L1, order 0), f2 (L1, order 2)
// Expected order: f1, f4, f3, f2 — layer beats order.
const MODULES: ModuleNode[] = [
  mod('f2', 'foundations', 2, ['f1']),
  mod('f3', 'foundations', 0, ['f1']),
  mod('f4', 'foundations', 5),
  mod('f1', 'foundations', 1),
  mod('g1', 'agents', 1),
  mod('g2', 'agents', 0, ['g1']),
];
const LESSONS: LessonRef[] = [
  { id: 'g2-a', module: 'g2', order: 1 },
  { id: 'g1-a', module: 'g1', order: 1 },
  { id: 'f2-a', module: 'f2', order: 1 },
  { id: 'f3-a', module: 'f3', order: 1 },
  { id: 'f4-a', module: 'f4', order: 1 },
  { id: 'f1-b', module: 'f1', order: 2 },
  { id: 'f1-a', module: 'f1', order: 1 },
];
const FOUNDATIONS_ORDER = ['f1-a', 'f1-b', 'f4-a', 'f3-a', 'f2-a'];

const done = (ids: string[], lastCourse?: string): State => ({
  ...emptyState(),
  lessons: Object.fromEntries(ids.map((id) => [id, { done: true, completedAt: AT, updatedAt: AT }])),
  settings: lastCourse ? { lastCourse } : {},
});

describe('nextLesson', () => {
  it('defaults to the first foundations lesson by module then lesson order', () => {
    expect(nextLesson(LESSONS, MODULES, emptyState())).toBe('f1-a');
  });

  it('walks foundations by (layer, order) then lesson order', () => {
    for (let i = 0; i < FOUNDATIONS_ORDER.length; i++) {
      expect(nextLesson(LESSONS, MODULES, done(FOUNDATIONS_ORDER.slice(0, i)))).toBe(FOUNDATIONS_ORDER[i]);
    }
  });

  it('returns the first undone lesson even if later ones are done', () => {
    expect(nextLesson(LESSONS, MODULES, done(['f1-b', 'f4-a']))).toBe('f1-a');
  });

  it('respects settings.lastCourse', () => {
    expect(nextLesson(LESSONS, MODULES, done([], 'agents'))).toBe('g1-a');
    expect(nextLesson(LESSONS, MODULES, done(['g1-a'], 'agents'))).toBe('g2-a');
  });

  it('falls back to foundations when the last course is fully done', () => {
    expect(nextLesson(LESSONS, MODULES, done(['g1-a', 'g2-a', 'f1-a'], 'agents'))).toBe('f1-b');
  });

  it('falls back to foundations when lastCourse is unknown', () => {
    expect(nextLesson(LESSONS, MODULES, done([], 'nope'))).toBe('f1-a');
  });

  it('returns null when foundations is done and lastCourse is foundations', () => {
    expect(nextLesson(LESSONS, MODULES, done(FOUNDATIONS_ORDER))).toBeNull();
  });

  it('returns null when both the last course and foundations are done', () => {
    expect(nextLesson(LESSONS, MODULES, done([...FOUNDATIONS_ORDER, 'g1-a', 'g2-a'], 'agents'))).toBeNull();
  });

  it('does not jump to another course when foundations is done', () => {
    // agents still has lessons, but lastCourse defaults to foundations and fallback is foundations only.
    expect(nextLesson(LESSONS, MODULES, done(FOUNDATIONS_ORDER))).toBeNull();
  });

  it('returns null with no lessons', () => {
    expect(nextLesson([], MODULES, emptyState())).toBeNull();
    expect(nextLesson([], [], emptyState())).toBeNull();
  });
});
