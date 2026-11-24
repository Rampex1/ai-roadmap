import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const [quizzes, docs] = await Promise.all([getCollection('quizzes'), getCollection('docs')]);
  const moduleOf = new Map(docs.map((doc) => [doc.id, doc.data.module]));
  const itemModule: Record<string, string> = {};
  for (const quiz of quizzes) {
    const module = moduleOf.get(quiz.id);
    if (module) for (const item of quiz.data.items) itemModule[item.id] = module;
  }
  return new Response(JSON.stringify(itemModule), { headers: { 'Content-Type': 'application/json' } });
};
