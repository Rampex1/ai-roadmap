import { useEffect, useMemo, useRef, useState } from 'react';
import { getScheduler, retrievability, type Scheduler } from '@/lib/srs';
import { pickCheckItems, recordCheck, scoreCheck, PASS_MARK } from '@/lib/mastery';
import type { PoolItem } from '@/lib/pool';
import { QuizItemCard } from './Quiz';
import { useProgress } from './useProgress';
import { saveErrorText } from './saveError';

export default function MasteryCheck({ moduleId, moduleTitle, items }: { moduleId: string; moduleTitle: string; items: PoolItem[] }) {
  const [state, store] = useProgress();
  const [sched, setSched] = useState<Scheduler | null>(null);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => void getScheduler().then(setSched), []);

  // Pick once per visit (after the scheduler loads), from the state at that moment.
  const picked = useMemo(() => {
    if (!sched) return null;
    const now = new Date();
    const ids = pickCheckItems(items, state.mastery[moduleId]?.lastItems ?? [], (id) => retrievability(sched, state.cards[id], now));
    const byId = new Map(items.map((i) => [i.id, i]));
    return ids.map((id) => byId.get(id)!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sched, items, moduleId]);

  const answered = Object.keys(results).length;
  const done = !!picked && picked.length > 0 && answered === picked.length;
  const correct = Object.values(results).filter(Boolean).length;
  const { score, passed } = scoreCheck(correct, picked?.length ?? 0);

  useEffect(() => {
    if (!done || !picked) return;
    const r = store.update((s) => recordCheck(s, moduleId, picked.map((p) => p.id), correct, new Date()));
    setError(saveErrorText(r));
    resultRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (!picked) return <p className="not-content" role="status">Preparing your check…</p>;
  if (!picked.length) return <p className="not-content">This module has no quiz items yet.</p>;

  const weak = [...new Map(picked.filter((p) => results[p.id] === false).map((p) => [p.lesson, p])).values()];
  const best = state.mastery[moduleId];
  return (
    <div className="not-content" data-mastery-check={moduleId}>
      <p className="air-quiz-sub">
        {picked.length} questions drawn from across {moduleTitle}. Score {Math.round(PASS_MARK * 100)}% or more to master the module.
        {best ? ` Attempts so far: ${best.attempts}; best ${Math.round(best.best * 100)}%.` : ''}
      </p>
      <p className="air-check-progress" aria-live="polite">{answered} of {picked.length} answered</p>
      {picked.map((it, n) => (
        <QuizItemCard key={it.id} item={it} n={n + 1} onGraded={(ok) => setResults((r) => (it.id in r ? r : { ...r, [it.id]: ok }))} />
      ))}
      {done && (
        <div ref={resultRef} tabIndex={-1} className={`air-card air-check-result ${passed ? 'is-pass' : 'is-fail'}`} data-check-result data-passed={String(passed)}>
          <h2>{passed ? 'Module mastered' : 'Not yet — keep going'}</h2>
          <p>
            You scored {correct} / {picked.length} ({Math.round(score * 100)}%).{' '}
            {passed ? 'This module now counts as mastered.' : `You need ${Math.round(PASS_MARK * 100)}% to pass.`}
          </p>
          {!passed && weak.length > 0 && (
            <>
              <p>Revisit these lessons, then try again:</p>
              <ul>{weak.map((w) => <li key={w.lesson}><a href={`/${w.lesson}/`}>{w.lessonTitle}</a></li>)}</ul>
            </>
          )}
          <button type="button" className="air-btn" onClick={() => location.reload()}>Take a new check</button>
          {error && <p role="alert" className="air-callout air-callout-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
