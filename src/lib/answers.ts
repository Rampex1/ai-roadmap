// Single hook every quiz-like island calls after grading an item.
// M6 connects this to FSRS scheduling; until then answers only drive feedback.
type Listener = (itemId: string, correct: boolean) => void;
const listeners = new Set<Listener>();
export function onAnswer(itemId: string, correct: boolean) {
  listeners.forEach((l) => l(itemId, correct));
}
export function listenAnswers(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
