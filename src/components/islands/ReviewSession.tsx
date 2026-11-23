import { useMemo } from 'react';
import { dueItems } from '@/lib/srs';
import type { PoolItem } from '@/lib/pool';
import { QuizItemCard } from './Quiz';
import { useProgress } from './useProgress';

const CAP = 50;

export default function ReviewSession({ items }: { items: PoolItem[] }) {
  const [state] = useProgress();
  // Freeze the session's item list when it starts, so answering doesn't reshuffle the page.
  const session = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const due = dueItems(state, new Date(), new Set(byId.keys()));
    for (let i = due.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [due[i], due[j]] = [due[j], due[i]];
    }
    return due.slice(0, CAP).map((id) => byId.get(id)!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  const total = Object.keys(state.cards).length;
  if (!session.length)
    return (
      <div className="air-card not-content" data-review-empty>
        <h2>Nothing due right now</h2>
        <p>
          {total
            ? `You have ${total} item${total === 1 ? '' : 's'} on your schedule. Come back when they're due.`
            : 'Answer lesson quizzes and the items you see will be scheduled for review here.'}
        </p>
      </div>
    );
  return (
    <section className="air-quiz not-content" aria-labelledby="review-title" data-review>
      <h2 id="review-title">{session.length} item{session.length === 1 ? '' : 's'} due</h2>
      <p className="air-quiz-sub">Mixed across lessons on purpose — interleaving makes recall stronger.</p>
      {session.map((it, n) => (
        <div key={it.id}>
          <p className="air-review-source">From <a href={`/${it.lesson}/`}>{it.lessonTitle}</a></p>
          <QuizItemCard item={it} n={n + 1} />
        </div>
      ))}
    </section>
  );
}
