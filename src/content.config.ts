import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const COURSES = ['foundations', 'mle', 'research', 'llm'] as const;

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase kebab-case');
const md = z.string().min(1); // markdown string

const lessonFields = ['module', 'order', 'estMinutes', 'objectives'] as const;

const docs = defineCollection({
  loader: docsLoader(),
  schema: (ctx) =>
    docsSchema({
      extend: z.object({
        module: id.optional(),
        order: z.number().optional(),
        estMinutes: z.number().int().positive().optional(),
        objectives: z.array(z.string().min(1)).min(1).optional(),
        goDeeper: id.optional(),
        overview: z.boolean().optional(), // set by StarlightPage overview pages, which are not lessons
      }),
    })(ctx).superRefine((data, c) => {
      // Every page except splash pages (the home) and overview pages is a lesson and needs the lesson fields.
      if (data.template === 'splash' || data.overview) return;
      for (const f of lessonFields)
        if (data[f] === undefined) c.addIssue({ code: 'custom', path: [f], message: `lesson frontmatter requires "${f}"` });
    }),
});

const modules = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/modules' }),
  schema: z.object({
    id,
    course: z.enum(COURSES),
    title: z.string().min(1),
    order: z.number(),
    prereqs: z.array(id),
    objectives: z.array(z.string().min(1)).min(1),
    capstone: id.optional(),
  }),
});

const base = { id, prompt: md, explanation: md };
const option = z.object({ text: md, correct: z.boolean().optional(), why: md });
const quizItem = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('mcq'), options: z.array(option).min(2) }),
  z.object({ ...base, type: z.literal('multi'), options: z.array(option).min(2) }),
  z.object({ ...base, type: z.literal('numeric'), answer: z.number(), tol: z.number().nonnegative().optional(), rtol: z.number().nonnegative().optional() }),
  z.object({ ...base, type: z.literal('output'), code: z.string().min(1), answer: z.string() }),
  z.object({ ...base, type: z.literal('order'), items: z.array(z.string().min(1)).min(2) })
    .refine((q) => new Set(q.items).size === q.items.length, { message: 'order items must be unique' }),
  z.object({ ...base, type: z.literal('cloze'), accept: z.array(z.string().min(1)).min(1).optional(), regex: z.string().optional() })
    .refine((q) => q.accept || q.regex, { message: 'cloze needs accept[] or regex' }),
]).superRefine((q, c) => {
  if (q.type === 'mcq' || q.type === 'multi') {
    const n = q.options.filter((o) => o.correct).length;
    if (q.type === 'mcq' && n !== 1) c.addIssue({ code: 'custom', path: ['options'], message: `mcq needs exactly one correct option, has ${n}` });
    if (q.type === 'multi' && n < 1) c.addIssue({ code: 'custom', path: ['options'], message: 'multi needs at least one correct option' });
  }
  if (q.type === 'cloze' && q.regex !== undefined) {
    try { new RegExp(q.regex, 'i'); } catch (e) { c.addIssue({ code: 'custom', path: ['regex'], message: `invalid regex: ${(e as Error).message}` }); }
  }
});
export type QuizItem = z.infer<typeof quizItem>;

const quizzes = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/quizzes' }),
  schema: z.object({ items: z.array(quizItem).min(1) }),
});

const exercises = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/exercises' }),
  schema: z.object({
    id,
    lesson: z.string().min(1),
    title: z.string().min(1),
    prompt: md,
    starter: z.string(),
    solution: z.string().min(1),
    tests: z.string().min(1),
    hints: z.array(z.string().min(1)),
  }),
});

const homework = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/homework' }),
  schema: z.object({
    id,
    module: id,
    kind: z.enum(['homework', 'capstone']),
    title: z.string().min(1),
    brief: md,
    notebook: z.string().regex(/^\/homework\/.+\.ipynb$/, 'notebook must be a path under /homework/'),
    colab: z.url().optional(),
    rubric: z.array(z.string().min(1)).min(1),
    compute: z.string().min(1),
  }),
});

const glossary = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/glossary' }),
  schema: z.object({ term: z.string().min(1), short: z.string().min(1), body: md, related: z.array(id) }),
});

const resources = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/resources' }),
  schema: z.object({
    title: z.string().min(1),
    url: z.url(),
    kind: z.enum(['video', 'book', 'course', 'paper', 'tool']),
    free: z.boolean(),
    modules: z.array(id),
  }),
});

export const collections = { docs, modules, quizzes, exercises, homework, glossary, resources };
