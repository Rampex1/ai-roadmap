// Spaced repetition on quiz items with ts-fsrs (design §5.5 "Quiz and FSRS rules").
import { DefaultScheduler, Rating } from 'ts-fsrs';
import type { State } from './progress';

export type Scheduler = Awaited<ReturnType<typeof DefaultScheduler>>;
type Card = State['cards'][string];

let cached: Promise<Scheduler> | undefined;
export function getScheduler(): Promise<Scheduler> {
  return (cached ??= DefaultScheduler({ enableFuzz: false }));
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Grade one answer. Only the first attempt per item per local calendar day counts. */
export function applyAnswer(s: Scheduler, state: State, itemId: string, correct: boolean, now: Date): State {
  const prev = state.cards[itemId];
  if (prev?.lastReviewAt && sameLocalDay(new Date(prev.lastReviewAt), now)) return state;
  const base = prev ? { ...prev } : s.newCard({ now });
  const { card } = s.review({ card: base as any, grade: correct ? Rating.Good : Rating.Again, now });
  const at = now.toISOString();
  return {
    ...state,
    cards: { ...state.cards, [itemId]: { ...(card as any), updatedAt: at } as Card },
    reviews: [...state.reviews, { itemId, grade: correct ? 'Good' : 'Again', at }],
  };
}

/** Cards due now. Skips cards already reviewed today (a second answer today wouldn't count) and,
 *  when `known` is given, cards whose quiz item no longer exists. */
export function dueItems(state: State, now: Date, known?: Set<string>): string[] {
  return Object.entries(state.cards)
    .filter(([id]) => !known || known.has(id))
    .filter(([, c]) => !(c.lastReviewAt && sameLocalDay(new Date(c.lastReviewAt), now)))
    .filter(([, c]) => new Date(c.dueAt).getTime() <= now.getTime())
    .sort(([, a], [, b]) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .map(([id]) => id);
}

export function retrievability(s: Scheduler, card: Card | undefined, now: Date): number {
  if (!card?.lastReviewAt) return 0;
  const elapsedDays = Math.max(0, (now.getTime() - new Date(card.lastReviewAt).getTime()) / 86_400_000);
  const r = (s.model as any).forgettingCurve(card, elapsedDays);
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
}
