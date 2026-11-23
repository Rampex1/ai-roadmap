import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { getCollection } from 'astro:content';
import { filterSidebar, flattenLinks } from '@/lib/sidebar';

type Entry = { type: string; label: string; href?: string; isCurrent?: boolean; entries?: Entry[] };

// Lesson and module order come from frontmatter/YAML, not file names (autogenerate sorts by name).
let orderCache: Promise<{ lesson: Map<string, number>; module: Map<string, { order: number; title: string }> }> | undefined;
const orders = () =>
  (orderCache ??= (async () => {
    const [docs, modules] = await Promise.all([getCollection('docs'), getCollection('modules')]);
    return {
      lesson: new Map(docs.map((d) => [`/${d.id}/`, (d.data as { order?: number }).order ?? 0])),
      module: new Map(modules.map((m) => [m.data.id, { order: m.data.order, title: m.data.title }])),
    };
  })());

function arrange(entries: Entry[], o: Awaited<ReturnType<typeof orders>>): Entry[] {
  const rankOf = (e: Entry) =>
    e.type === 'link' ? o.lesson.get(e.href ?? '') ?? 0 : o.module.get(e.label.toLowerCase())?.order ?? 0;
  const moduleGroups = entries.length > 0 && entries.every((e) => e.type === 'group' && o.module.has(e.label.toLowerCase()));
  const lessonLinks = entries.length > 0 && entries.every((e) => e.type === 'link' && o.lesson.has(e.href ?? ''));
  const out = entries.map((e) => {
    if (e.type !== 'group') return e;
    const mod = o.module.get(e.label.toLowerCase());
    return { ...e, label: mod ? `${e.label.toUpperCase()} · ${mod.title}` : e.label, entries: arrange(e.entries ?? [], o) };
  });
  return moduleGroups || lessonLinks ? [...out].sort((a, b) => rankOf(a) - rankOf(b)) : out;
}

// Filter the sidebar to the current course, order modules and lessons, and recompute prev/next
// from lesson links only, so pagination never jumps into another course or onto site pages.
export const onRequest = defineRouteMiddleware(async (context) => {
  const route = context.locals.starlightRoute;
  const o = await orders();
  route.sidebar = arrange(filterSidebar(route.sidebar as Entry[], context.url.pathname), o) as any;
  const links = flattenLinks((route.sidebar as Entry[]).filter((e) => e.type === 'group')) as Entry[];
  const i = links.findIndex((l) => l.isCurrent);
  if (i >= 0) route.pagination = { prev: (links[i - 1] as any) ?? undefined, next: (links[i + 1] as any) ?? undefined };
});
