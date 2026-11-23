// Module mastery checks (design §5.5): interleaved, weakest items first, pass at 80%.
import type { State } from './progress';

export const CHECK_SIZE = 12;
export const PASS_MARK = 0.8;

export function pickCheckItems(
  pool: { id: string; lesson: string }[],
  lastItems: string[],
  retr: (id: string) => number,
  n = CHECK_SIZE,
): string[] {
  const last = new Set(lastItems);
  const fresh = pool.filter((p) => !last.has(p.id));
  const stale = pool.filter((p) => last.has(p.id));
  const out: string[] = [];
  roundRobin(fresh, retr, n, out);
  // Not enough fresh items: let the last attempt's items back in, after all fresh ones.
  if (out.length < n) roundRobin(stale, retr, n, out);
  return out;
}

/** Interleave across lessons (first-appearance order), weakest item first within each lesson. */
function roundRobin(items: { id: string; lesson: string }[], retr: (id: string) => number, n: number, out: string[]) {
  const byLesson = new Map<string, string[]>();
  for (const p of items) {
    if (!byLesson.has(p.lesson)) byLesson.set(p.lesson, []);
    const ids = byLesson.get(p.lesson)!;
    if (!ids.includes(p.id)) ids.push(p.id);
  }
  for (const ids of byLesson.values()) ids.sort((a, b) => retr(a) - retr(b) || a.localeCompare(b));
  const queues = [...byLesson.values()];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (out.length >= n) break;
      const id = q.shift();
      if (id && !out.includes(id)) out.push(id);
    }
  }
}

export function scoreCheck(correct: number, total: number): { score: number; passed: boolean } {
  const score = total > 0 ? correct / total : 0;
  return { score, passed: total > 0 && score >= PASS_MARK };
}

export function recordCheck(state: State, moduleId: string, items: string[], correct: number, now: Date): State {
  const prev = state.mastery[moduleId];
  const { score, passed } = scoreCheck(correct, items.length);
  return {
    ...state,
    mastery: {
      ...state.mastery,
      [moduleId]: {
        best: Math.max(prev?.best ?? 0, score),
        mastered: (prev?.mastered ?? false) || passed,
        attempts: (prev?.attempts ?? 0) + 1,
        lastItems: items,
        updatedAt: now.toISOString(),
      },
    },
  };
}
