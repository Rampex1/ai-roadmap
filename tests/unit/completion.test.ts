import { describe, it, expect } from 'vitest';
import { emptyState, type State } from '@/lib/progress';
import { courseComplete } from '@/lib/completion';

const AT = '2026-01-01T00:00:00.000Z';
const state = (mastered: string[], projects: Record<string, boolean> = {}): State => ({
  ...emptyState(),
  mastery: Object.fromEntries(mastered.map((id) => [id, { best: 1, mastered: true, attempts: 1, lastItems: [], updatedAt: AT }])),
  projects: Object.fromEntries(Object.entries(projects).map(([id, passed]) => [id, { rubricChecked: [], passed, updatedAt: AT }])),
});

const MODULES = [
  { id: 'f1', course: 'foundations' },
  { id: 'f2', course: 'foundations', capstone: 'cap-f' },
  { id: 'x1', course: 'other' },
];

describe('courseComplete', () => {
  it('is true when every module is mastered and the capstone passed', () => {
    expect(courseComplete('foundations', MODULES, state(['f1', 'f2'], { 'cap-f': true }))).toBe(true);
  });

  it('is false when the capstone is not passed', () => {
    expect(courseComplete('foundations', MODULES, state(['f1', 'f2'], { 'cap-f': false }))).toBe(false);
  });

  it('is false when the capstone has no project record', () => {
    expect(courseComplete('foundations', MODULES, state(['f1', 'f2']))).toBe(false);
  });

  it('is false when a module is not mastered even if the capstone passed', () => {
    expect(courseComplete('foundations', MODULES, state(['f2'], { 'cap-f': true }))).toBe(false);
  });

  it('is false when a module has a non-mastered mastery record', () => {
    const st = state(['f2'], { 'cap-f': true });
    st.mastery.f1 = { best: 0.7, mastered: false, attempts: 3, lastItems: [], updatedAt: AT };
    expect(courseComplete('foundations', MODULES, st)).toBe(false);
  });

  it('needs only mastery for a course with no capstone', () => {
    expect(courseComplete('other', MODULES, state(['x1']))).toBe(true);
  });

  it('is false for a course with no modules', () => {
    expect(courseComplete('empty', MODULES, state(['f1', 'f2', 'x1']))).toBe(false);
    expect(courseComplete('foundations', [], state([]))).toBe(false);
  });

  it('ignores modules and capstones of other courses', () => {
    const mods = [...MODULES, { id: 'x2', course: 'other', capstone: 'cap-x' }];
    expect(courseComplete('foundations', mods, state(['f1', 'f2'], { 'cap-f': true }))).toBe(true);
    expect(courseComplete('other', mods, state(['x1', 'x2']))).toBe(false);
  });
});
