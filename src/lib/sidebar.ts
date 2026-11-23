export const COURSE_NAMES: Record<string, string> = {
  foundations: 'Foundations',
  mle: 'ML Engineering',
  research: 'Research',
  llm: 'LLM Engineering',
};
const COURSES = Object.keys(COURSE_NAMES);

export function courseOf(pathname: string): string | null {
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  return COURSES.includes(first) ? first : null;
}

type Entry = { type: string; href?: string; entries?: Entry[] };

const hasLinkUnder = (e: Entry, prefix: string): boolean =>
  e.type === 'link' ? !!e.href?.startsWith(prefix) : (e.entries ?? []).some((c) => hasLinkUnder(c, prefix));

/** Inside a course, keep only the top-level groups that link into that course. */
export function filterSidebar<T extends Entry>(sidebar: T[], pathname: string): T[] {
  const course = courseOf(pathname);
  if (!course) return sidebar;
  const kept = sidebar.filter((e) => hasLinkUnder(e, `/${course}/`));
  return kept.length ? kept : sidebar; // course without lessons yet: keep the full sidebar
}

/** Flatten links in sidebar order (for prev/next pagination). */
export function flattenLinks<T extends Entry>(sidebar: T[]): T[] {
  return sidebar.flatMap((e) => (e.type === 'link' ? [e] : flattenLinks((e.entries ?? []) as T[])));
}
