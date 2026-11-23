import { defineConfig } from 'astro/config';
import { existsSync, readdirSync } from 'node:fs';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { unified } from '@astrojs/markdown-remark';

const courses = [
  ['Foundations', 'foundations'],
  ['ML Engineering', 'mle'],
  ['Research', 'research'],
  ['LLM Engineering', 'llm'],
];
// Starlight's autogenerate fails on a missing/empty directory, so only list courses with content.
const hasContent = (slug) => {
  const dir = new URL(`./src/content/docs/${slug}/`, import.meta.url);
  return existsSync(dir) && readdirSync(dir, { recursive: true }).some((f) => /\.mdx?$/.test(f));
};

export default defineConfig({
  site: 'http://localhost:4321',
  server: { port: 4321 },
  // Astro 7 defaults to Sätteri, which can't run remark/rehype plugins; use unified for KaTeX.
  markdown: { processor: unified({ remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] }) },
  integrations: [
    starlight({
      title: 'AI Roadmap',
      routeMiddleware: './src/routeData.ts',
      components: {
        PageTitle: './src/components/overrides/PageTitle.astro',
        Search: './src/components/overrides/Search.astro',
      },
      customCss: ['katex/dist/katex.min.css', './src/styles/theme.css'],
      sidebar: courses
        .filter(([, slug]) => hasContent(slug))
        .map(([label, directory]) => ({ label, items: [{ autogenerate: { directory } }] })),
    }),
    react(),
  ],
});
