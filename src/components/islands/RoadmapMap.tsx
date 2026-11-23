import { COURSE_NAMES } from '@/lib/sidebar';
import { layers, moduleStatus } from '@/lib/roadmap';
import type { SiteLesson, SiteModule } from '@/lib/site-data';
import { useProgress } from './useProgress';

const LABEL = { mastered: 'Mastered', 'in-progress': 'In progress', available: 'Ready to start', 'prereqs-missing': 'Prerequisites first' } as const;

export default function RoadmapMap({ modules, lessons }: { modules: SiteModule[]; lessons: SiteLesson[] }) {
  const [state] = useProgress();
  const layer = layers(modules);
  const byId = new Map(modules.map((m) => [m.id, m]));
  return (
    <div className="air-roadmap not-content">
      <ul className="air-legend" aria-label="Legend">
        {Object.entries(LABEL).map(([k, v]) => (
          <li key={k}><span className={`air-dot is-${k}`} aria-hidden="true" />{v}</li>
        ))}
      </ul>
      {Object.entries(COURSE_NAMES).map(([course, name]) => {
        const mods = modules.filter((m) => m.course === course);
        const min = Math.min(...mods.map((m) => layer[m.id]));
        const cols = new Map<number, SiteModule[]>();
        for (const m of mods.sort((a, b) => a.order - b.order)) {
          const c = layer[m.id] - min;
          cols.set(c, [...(cols.get(c) ?? []), m]);
        }
        const entry = [...new Set(mods.flatMap((m) => m.prereqs).filter((p) => byId.get(p)?.course !== course))];
        return (
          <section key={course} className="air-band" aria-labelledby={`band-${course}`}>
            <h2 id={`band-${course}`}>{name}</h2>
            {entry.length > 0 && <p className="air-band-entry">Starts after {entry.map((p) => p.toUpperCase()).join(', ')}</p>}
            <ol className="air-band-cols">
              {[...cols.entries()].sort(([a], [b]) => a - b).map(([c, ms]) => (
                <li key={c} className="air-band-col">
                  <ul>
                    {ms.map((m) => {
                      const ls = lessons.filter((l) => l.module === m.id);
                      const status = moduleStatus(m, state, ls.length, ls.filter((l) => state.lessons[l.id]).length);
                      return (
                        <li key={m.id}>
                          <a className={`air-node is-${status}`} href={`/${course}/${m.id}/`} data-module-node={m.id} data-status={status}
                             aria-label={`${m.id.toUpperCase()} ${m.title}: ${LABEL[status]}`}>
                            <span className="air-node-id">{m.id.toUpperCase()}</span>
                            <span className="air-node-title">{m.title}</span>
                            <span className="air-node-status">{LABEL[status]}{ls.length ? '' : ' · soon'}</span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
