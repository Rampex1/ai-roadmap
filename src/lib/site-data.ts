// Build-time snapshot of the course structure, passed to client islands as props.
import { getCollection } from 'astro:content';

export type SiteModule = { id: string; course: string; order: number; prereqs: string[]; title: string; capstone?: string };
export type SiteLesson = { id: string; module: string; order: number; title: string; course: string };

export async function siteData(): Promise<{ modules: SiteModule[]; lessons: SiteLesson[] }> {
  const [mods, docs] = await Promise.all([getCollection('modules'), getCollection('docs')]);
  const modules = mods.map(({ data: m }) => ({ id: m.id, course: m.course, order: m.order, prereqs: m.prereqs, title: m.title, capstone: m.capstone }));
  const courseOf = new Map(modules.map((m) => [m.id, m.course]));
  const lessons = docs
    .filter((d) => (d.data as any).module && !(d.data as any).overview && d.data.template !== 'splash')
    .map((d) => {
      const data = d.data as any;
      return { id: d.id, module: data.module, order: data.order ?? 0, title: d.data.title, course: courseOf.get(data.module) ?? '' };
    });
  return { modules, lessons };
}
