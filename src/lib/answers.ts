// Every quiz-like island calls onAnswer after grading an item; this feeds FSRS (design §5.5).
import { applyAnswer, getScheduler } from './srs';
import { progress } from './progress';
import { courseOf } from './sidebar';

export async function onAnswer(itemId: string, correct: boolean) {
  const s = await getScheduler();
  const course = courseOf(location.pathname);
  return progress().update((st) => {
    const next = applyAnswer(s, st, itemId, correct, new Date());
    return course && next !== st ? { ...next, settings: { ...next.settings, lastCourse: course } } : next;
  });
}
