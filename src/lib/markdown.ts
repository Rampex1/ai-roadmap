// Build-time markdown → HTML (with KaTeX) for strings stored in YAML (quiz prompts, explanations, ...).
// Islands are client:only, so they receive pre-rendered HTML instead of shipping a renderer.
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

let processor: ReturnType<typeof createMarkdownProcessor> | undefined;
const get = () => (processor ??= createMarkdownProcessor({ remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex], syntaxHighlight: false }));

export async function md(s: string): Promise<string> {
  return (await (await get()).render(s)).code;
}

/** Inline variant: drops a single wrapping <p> so the result fits in a label or legend. */
export async function mdInline(s: string): Promise<string> {
  const html = (await md(s)).trim();
  const m = html.match(/^<p>([\s\S]*)<\/p>$/);
  return m && !m[1].includes('<p>') ? m[1] : html;
}
