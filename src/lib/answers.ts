// Every quiz-like island calls onAnswer after grading an item; this feeds FSRS (design §5.5).
import { applyAnswer, getScheduler } from './srs';
import { progress } from './progress';

export async function onAnswer(itemId: string, correct: boolean) {
  const s = await getScheduler();
  return progress().update((st) => applyAnswer(s, st, itemId, correct, new Date()));
}
