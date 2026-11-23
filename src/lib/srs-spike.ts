// M1b spike: proves ts-fsrs v6 bundles and runs in the browser. Task 7 replaces this with srs.ts.
import { DefaultScheduler, Rating } from 'ts-fsrs';

export async function srsSpike(now = new Date()) {
  const s = await DefaultScheduler();
  const card = s.newCard({ now });
  const { card: next, revlog } = s.review({ card, grade: Rating.Good, now });
  return { card: next, revlog, retrievability: s.model.forgettingCurve(next, 1) };
}
