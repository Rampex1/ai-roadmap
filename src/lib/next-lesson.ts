// What the dashboard's Continue button opens.
import type { State } from './progress';
import { layers, type ModuleNode } from './roadmap';

export type LessonRef = { id: string; module: string; order: number };

export function nextLesson(lessons: LessonRef[], modules: ModuleNode[], state: State): string | null {
  const layer = layers(modules);
  const find = (course: string) => {
    const mods = modules
      .filter((m) => m.course === course)
      .sort((a, b) => layer[a.id] - layer[b.id] || a.order - b.order);
    for (const m of mods) {
      const next = lessons
        .filter((l) => l.module === m.id)
        .sort((a, b) => a.order - b.order)
        .find((l) => !state.lessons[l.id]);
      if (next) return next.id;
    }
    return null;
  };
  const course = state.settings.lastCourse ?? 'foundations';
  return find(course) ?? (course !== 'foundations' ? find('foundations') : null);
}
