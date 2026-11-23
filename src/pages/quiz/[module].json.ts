// Per-module quiz items as static JSON, so /review/ only downloads the modules that have due items.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { quizPool } from '@/lib/pool';

export async function getStaticPaths() {
  return (await getCollection('modules')).map((m) => ({ params: { module: m.data.id } }));
}

export const GET: APIRoute = async ({ params }) =>
  new Response(JSON.stringify(await quizPool((m) => m === params.module)), { headers: { 'Content-Type': 'application/json' } });
