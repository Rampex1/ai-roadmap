import type { State } from './progress';

/** A course is complete when every module is mastered and its capstone (if any) is passed. */
export function courseComplete(course: string, modules: { id: string; course: string; capstone?: string }[], state: State): boolean {
  const mine = modules.filter((m) => m.course === course);
  if (!mine.length || !mine.every((m) => state.mastery[m.id]?.mastered)) return false;
  return mine.every((m) => !m.capstone || state.projects[m.capstone]?.passed === true);
}
