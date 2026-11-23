import { useEffect, useRef, useState } from 'react';
import { markLessonDone } from '@/lib/progress';
import { useProgress } from './useProgress';
import { saveErrorText } from './saveError';

export default function LessonComplete({ lessonId, course }: { lessonId: string; course: string }) {
  const [state, store] = useProgress();
  const [error, setError] = useState<string | null>(store.corrupt ? saveErrorText({ ok: false, error: 'corrupt' }) : null);
  const [justDone, setJustDone] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const done = !!state.lessons[lessonId];
  useEffect(() => {
    if (justDone) statusRef.current?.focus();
  }, [justDone]);
  const complete = () => {
    const r = store.update((s) => {
      const next = markLessonDone(s, lessonId, new Date());
      return { ...next, settings: { ...next.settings, lastCourse: course } };
    });
    setError(saveErrorText(r));
    setJustDone(r.ok);
  };
  return (
    <div className="air-complete not-content">
      {done ? (
        <p className="air-complete-done" role="status" tabIndex={-1} ref={statusRef}>
          <span aria-hidden="true">✓</span> Lesson completed
        </p>
      ) : (
        <button type="button" className="air-btn air-btn-primary" onClick={complete}>
          Mark complete
        </button>
      )}
      {error && <p role="alert" className="air-callout air-callout-error">{error} <a href="/settings/">Settings</a></p>}
    </div>
  );
}
