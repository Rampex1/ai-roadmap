import { useProgress } from './useProgress';

export default function PrereqBanner({ moduleId, course, prereqs }: { moduleId: string; course: string; prereqs: { id: string; course: string; title: string }[] }) {
  const [state] = useProgress();
  const missing = prereqs.filter((p) => !state.mastery[p.id]?.mastered);
  if (!missing.length || state.mastery[moduleId]?.mastered) return null;
  return (
    <div className="air-callout air-callout-info not-content" data-prereq-banner>
      <p>
        <strong>Suggested first:</strong>{' '}
        {missing.map((p, i) => (
          <span key={p.id}>
            {i > 0 && ', '}
            <a href={`/${p.course}/${p.id}/`}>{p.id.toUpperCase()} {p.title}</a>
          </span>
        ))}
        . Already know this? <a href={`/${course}/${moduleId}/check/`}>Test out</a> with the mastery check.
      </p>
    </div>
  );
}
