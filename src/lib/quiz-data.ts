// Prepare quiz items for the client: keep the raw fields graders need, add pre-rendered HTML.
import type { QuizItem } from './grading';
import { md, mdInline } from './markdown';

export type PreparedItem = QuizItem & {
  promptHtml: string;
  explanationHtml: string;
  optionsHtml?: { textHtml: string; whyHtml: string }[];
  itemsHtml?: string[];
};

export async function prepareItems(items: QuizItem[]): Promise<PreparedItem[]> {
  return Promise.all(
    items.map(async (it) => ({
      ...it,
      promptHtml: await mdInline(it.prompt),
      explanationHtml: await md(it.explanation),
      optionsHtml:
        'options' in it
          ? await Promise.all(it.options.map(async (o) => ({ textHtml: await mdInline(o.text), whyHtml: await mdInline(o.why) })))
          : undefined,
      itemsHtml: it.type === 'order' ? await Promise.all(it.items.map(mdInline)) : undefined,
    })),
  );
}
