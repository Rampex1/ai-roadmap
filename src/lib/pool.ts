// Build-time helpers: all quiz items, tagged with their lesson and module.
import { getCollection } from 'astro:content';
import { prepareItems, type PreparedItem } from './quiz-data';

export type PoolItem = PreparedItem & { lesson: string; module: string; lessonTitle: string };

export async function quizPool(filter?: (moduleId: string) => boolean): Promise<PoolItem[]> {
  const [quizzes, docs] = await Promise.all([getCollection('quizzes'), getCollection('docs')]);
  const lessons = new Map(docs.map((d) => [d.id, d]));
  const out: PoolItem[] = [];
  for (const q of quizzes) {
    const lesson = lessons.get(q.id);
    const module = (lesson?.data as { module?: string } | undefined)?.module;
    if (!lesson || !module || (filter && !filter(module))) continue;
    for (const it of await prepareItems(q.data.items)) out.push({ ...it, lesson: q.id, module, lessonTitle: lesson.data.title });
  }
  return out;
}
