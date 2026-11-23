import { COURSE_NAMES } from '@/lib/sidebar';
import { nextLesson } from '@/lib/next-lesson';
import { dueItems } from '@/lib/srs';
import { courseComplete } from '@/lib/completion';
import type { SiteLesson, SiteModule } from '@/lib/site-data';
import { useProgress } from './useProgress';

const BACKUP_DAYS = 7;

export default function Dashboard({ modules, lessons, itemIds }: { modules: SiteModule[]; lessons: SiteLesson[]; itemIds: string[] }) {
  const [state] = useProgress();
  const next = nextLesson(lessons, modules, state);
  const nextL = lessons.find((l) => l.id === next);
  const due = dueItems(state, new Date(), new Set(itemIds)).length;
  const last = state.settings.lastExportAt;
  const needsBackup = !last || Date.now() - Date.parse(last) > BACKUP_DAYS * 86_400_000;
  const started = Object.keys(state.lessons).length > 0;

  return (
    <div className="air-dash not-content">
      <section className="air-dash-hero" aria-labelledby="dash-next">
        <h2 id="dash-next" className="air-dash-label">{started ? 'Pick up where you left off' : 'Start here'}</h2>
        {nextL ? (
          <>
            <p className="air-dash-next-title">{nextL.title}</p>
            <p className="air-dash-next-meta">{COURSE_NAMES[nextL.course]} · Module {nextL.module.toUpperCase()}</p>
            <div className="air-row">
              <a className="air-btn air-btn-primary" href={`/${nextL.id}/`}>Continue →</a>
              {!started && <a className="air-btn" href="/settings/">Set up the optional AI tutor</a>}
            </div>
          </>
        ) : (
          <p>You're all caught up on the lessons written so far. Review what's due, or start a track from the <a href="/roadmap/">roadmap</a>.</p>
        )}
      </section>

      <div className="air-dash-grid">
        <a className="air-dash-tile" href="/review/">
          <span className="air-dash-num" data-due-count>{due}</span>
          <span className="air-dash-tile-label">review{due === 1 ? '' : 's'} due today</span>
        </a>
        <a className="air-dash-tile" href="/roadmap/">
          <span className="air-dash-num">{Object.values(state.mastery).filter((m) => m.mastered).length}</span>
          <span className="air-dash-tile-label">modules mastered of {modules.length}</span>
        </a>
      </div>

      {needsBackup && (
        <p className="air-callout air-callout-info" data-backup-reminder>
          Your progress lives only in this browser. {last ? `Last backup ${new Date(last).toLocaleDateString()}.` : 'You have not backed it up yet.'}{' '}
          <a href="/settings/">Export a backup</a>.
        </p>
      )}

      <section aria-labelledby="dash-courses">
        <h2 id="dash-courses">Courses</h2>
        <ul className="air-dash-courses">
          {Object.entries(COURSE_NAMES).map(([course, name]) => {
            const ls = lessons.filter((l) => l.course === course);
            const done = ls.filter((l) => state.lessons[l.id]).length;
            const pct = ls.length ? Math.round((done / ls.length) * 100) : 0;
            const mods = modules.filter((m) => m.course === course);
            const complete = courseComplete(course, mods, state);
            const first = mods.sort((a, b) => a.order - b.order)[0];
            return (
              <li key={course} className="air-dash-course" data-course-progress={course}>
                <div className="air-dash-course-head">
                  <a href={first ? `/${course}/${first.id}/` : '/roadmap/'}>{name}</a>
                  <span className="air-dash-pct">{complete ? 'Complete ✓' : `${pct}%`}</span>
                </div>
                <div className="air-progress" role="progressbar" aria-label={`${name} lessons completed`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <p className="air-dash-course-meta">
                  {ls.length ? `${done} of ${ls.length} lessons · ${mods.length} modules` : `${mods.length} modules · lessons coming soon`}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
