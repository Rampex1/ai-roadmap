import { useEffect, useState } from 'react';
import { dueItems } from '@/lib/srs';
import type { PoolItem } from '@/lib/pool';
import { QuizItemCard } from './Quiz';
import { useProgress } from './useProgress';

const CAP = 50;

export default function ReviewSession({ itemModule }: { itemModule: Record<string, string> }) {
  const [state] = useProgress();
  const [session, setSession] = useState<PoolItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Pick the due items once when the session starts (answering must not reshuffle the page),
  // then fetch only the modules they come from.
  useEffect(() => {
    const due = dueItems(state, new Date(), new Set(Object.keys(itemModule)));
    for (let i = due.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [due[i], due[j]] = [due[j], due[i]];
    }
    const picked = due.slice(0, CAP);
    const modules = [...new Set(picked.map((id) => itemModule[id]))];
    Promise.all(modules.map((m) => fetch(`/quiz/${m}.json`).then((r) => (r.ok ? (r.json() as Promise<PoolItem[]>) : Promise.reject(r.status)))))
      .then((lists) => {
        const byId = new Map(lists.flat().map((i) => [i.id, i]));
        setSession(picked.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
      })
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemModule]);
  if (failed) return <p role="alert" className="air-callout air-callout-error not-content">Could not load review items. Reload the page to try again.</p>;
  if (!session) return <p className="not-content" role="status">Loading your review…</p>;
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
