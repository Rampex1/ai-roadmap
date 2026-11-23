import { useState } from 'react';
import { useProgress } from './useProgress';
import { saveErrorText } from './saveError';

export default function ProjectChecklist({ projectId, rubric }: { projectId: string; rubric: string[] }) {
  const [state, store] = useProgress();
  const [error, setError] = useState<string | null>(null);
  const checked = rubric.map((_, i) => state.projects[projectId]?.rubricChecked[i] ?? false);
  const passed = checked.every(Boolean);
  const toggle = (i: number) => {
    const r = store.update((s) => {
      // Build from the fresh state so another tab's ticks aren't overwritten.
      const fresh = rubric.map((_, j) => s.projects[projectId]?.rubricChecked[j] ?? false);
      const next = fresh.map((c, j) => (j === i ? !c : c));
      return { ...s, projects: { ...s.projects, [projectId]: { rubricChecked: next, passed: next.every(Boolean), updatedAt: new Date().toISOString() } } };
    });
    setError(saveErrorText(r));
  };
  return (
    <section className="air-card not-content" aria-labelledby={`rubric-${projectId}`}>
      <h2 id={`rubric-${projectId}`}>Rubric</h2>
      <p>Tick each item honestly once your work meets it. The project counts as passed when every item is ticked.</p>
      <ul className="air-rubric">
        {rubric.map((r, i) => (
          <li key={i}>
            <label className="air-option">
              <input type="checkbox" checked={checked[i]} onChange={() => toggle(i)} />
              <span>{r}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className={`air-project-status ${passed ? 'is-pass' : ''}`} data-project-status aria-live="polite">
        {passed ? '✓ Passed — every rubric item is met.' : `${checked.filter(Boolean).length} of ${rubric.length} rubric items met.`}
      </p>
      {error && <p role="alert" className="air-callout air-callout-error">{error}</p>}
    </section>
  );
}
