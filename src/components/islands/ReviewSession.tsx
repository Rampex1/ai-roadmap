import { useEffect, useState } from 'react';
import { dueItems } from '@/lib/srs';
import type { PoolItem } from '@/lib/pool';
import { QuizItemCard } from './Quiz';
import { useProgress } from './useProgress';

const CAP = 50;

export default function ReviewSession() {
  const [state] = useProgress();
  const [session, setSession] = useState<PoolItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Pick the due items once when the session starts (answering must not reshuffle the page),
  // then fetch only the modules they come from.
  useEffect(() => {
    const due = dueItems(state, new Date());
    if (!due.length) {
      setSession([]);
      return;
    }
    const load = async () => {
      const index = await fetch('/quiz/index.json');
      if (!index.ok) throw new Error('Quiz index unavailable');
      const itemModule: Record<string, string> = await index.json();
      const known = due.filter((id) => Object.hasOwn(itemModule, id));
      for (let i = known.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [known[i], known[j]] = [known[j], known[i]];
      }
      const picked = known.slice(0, CAP);
      const modules = [...new Set(picked.map((id) => itemModule[id]))];
      const lists = await Promise.all(modules.map(async (module) => {
        const response = await fetch(`/quiz/${module}.json`);
        if (!response.ok) throw new Error(`Quiz module unavailable: ${module}`);
        return response.json() as Promise<PoolItem[]>;
      }));
      const byId = new Map(lists.flat().map((item) => [item.id, item]));
      setSession(picked.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
    };
    load().catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
