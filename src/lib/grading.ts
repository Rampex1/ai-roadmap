// Pure graders for the six quiz item types (design §5.4). No partial credit.

import type { QuizItem } from '@/content.config';
export type { QuizItem };
type Option = { text: string; correct?: boolean; why: string };

export type Response =
  | { type: 'mcq'; choice: number }
  | { type: 'multi'; choices: number[] }
  | { type: 'numeric'; value: string }
  | { type: 'output'; value: string }
  | { type: 'order'; order: string[] }
  | { type: 'cloze'; value: string };

export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/ +$/, ''))
    .join('\n')
    .trim();
}

export function grade(item: QuizItem, r: Response): boolean {
  if (item.type !== r.type) return false;
  switch (r.type) {
    case 'mcq':
      return !!(item as Extract<QuizItem, { options: Option[] }>).options[r.choice]?.correct;
    case 'multi': {
      const opts = (item as Extract<QuizItem, { options: Option[] }>).options;
      const want = opts.flatMap((o, i) => (o.correct ? [i] : []));
      const got = [...new Set(r.choices)].sort((a, b) => a - b);
      return got.length === want.length && got.every((c, i) => c === want[i]);
    }
    case 'numeric': {
      const it = item as Extract<QuizItem, { type: 'numeric' }>;
      const text = r.value.trim();
      const x = Number(text);
      if (text === '' || !Number.isFinite(x)) return false;
      const diff = Math.abs(x - it.answer);
      const byTol = diff <= (it.tol ?? 0);
      const byRtol = it.rtol !== undefined && diff <= it.rtol * Math.abs(it.answer);
      return byTol || byRtol;
    }
    case 'output':
      return normalizeOutput(r.value) === normalizeOutput((item as Extract<QuizItem, { type: 'output' }>).answer);
    case 'order': {
      const want = (item as Extract<QuizItem, { type: 'order' }>).items;
      return r.order.length === want.length && r.order.every((t, i) => t === want[i]);
    }
    case 'cloze': {
      const it = item as Extract<QuizItem, { type: 'cloze' }>;
      const v = r.value.trim();
      if (!v) return false;
      if (it.accept?.some((a) => a.trim().toLowerCase() === v.toLowerCase())) return true;
      return it.regex ? new RegExp(it.regex, 'i').test(v) : false;
    }
  }
}
