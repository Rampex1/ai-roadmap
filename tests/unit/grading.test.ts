import { describe, it, expect } from 'vitest';
import type { QuizItem } from '@/content.config';
import { grade, normalizeOutput } from '@/lib/grading';

const base = { id: 'q', prompt: 'p', explanation: 'e' };
const opt = (text: string, correct?: boolean) => ({ text, why: `why ${text}`, ...(correct ? { correct } : {}) });

const mcq: QuizItem = { ...base, type: 'mcq', options: [opt('a'), opt('b', true), opt('c')] };
const multi: QuizItem = { ...base, type: 'multi', options: [opt('a', true), opt('b'), opt('c', true), opt('d')] };
const numeric = (answer: number, extra: { tol?: number; rtol?: number } = {}): QuizItem => ({ ...base, type: 'numeric', answer, ...extra });
const output = (answer: string): QuizItem => ({ ...base, type: 'output', code: 'print(1)', answer });
const order: QuizItem = { ...base, type: 'order', items: ['first', 'second', 'third'] };
const cloze = (extra: { accept?: string[]; regex?: string }): QuizItem => ({ ...base, type: 'cloze', ...extra }) as QuizItem;

describe('grade: mcq', () => {
  it('is correct when the chosen option is marked correct', () => {
    expect(grade(mcq, { type: 'mcq', choice: 1 })).toBe(true);
  });
  it('is wrong when the chosen option is not marked correct', () => {
    expect(grade(mcq, { type: 'mcq', choice: 0 })).toBe(false);
  });
  it('is wrong for an out-of-range choice', () => {
    expect(grade(mcq, { type: 'mcq', choice: 9 })).toBe(false);
  });
});

describe('grade: multi', () => {
  it('is correct when exactly the correct options are chosen', () => {
    expect(grade(multi, { type: 'multi', choices: [0, 2] })).toBe(true);
  });
  it('ignores the order of choices', () => {
    expect(grade(multi, { type: 'multi', choices: [2, 0] })).toBe(true);
  });
  it('is wrong when a correct option is missing', () => {
    expect(grade(multi, { type: 'multi', choices: [0] })).toBe(false);
  });
  it('is wrong when an extra incorrect option is chosen', () => {
    expect(grade(multi, { type: 'multi', choices: [0, 1, 2] })).toBe(false);
  });
  it('ignores duplicate choices', () => {
    expect(grade(multi, { type: 'multi', choices: [0, 2, 2, 0] })).toBe(true);
  });
  it('is wrong when nothing is chosen', () => {
    expect(grade(multi, { type: 'multi', choices: [] })).toBe(false);
  });
});

describe('grade: numeric', () => {
  const r = (value: string) => ({ type: 'numeric' as const, value });
  it('without tol requires an exact match', () => {
    expect(grade(numeric(0.5), r('0.5'))).toBe(true);
    expect(grade(numeric(0.5), r('0.50001'))).toBe(false);
  });
  it('accepts surrounding whitespace', () => {
    expect(grade(numeric(0.5), r(' 0.5 '))).toBe(true);
  });
  it('accepts scientific notation', () => {
    expect(grade(numeric(0.001), r('1e-3'))).toBe(true);
  });
  it('accepts a value within tol, inclusive at the boundary', () => {
    expect(grade(numeric(1, { tol: 0.25 }), r('1.2'))).toBe(true);
    expect(grade(numeric(1, { tol: 0.25 }), r('0.75'))).toBe(true);
  });
  it('rejects a value outside tol', () => {
    expect(grade(numeric(1, { tol: 0.1 }), r('1.2'))).toBe(false);
  });
  it('accepts a value within rtol of the answer', () => {
    expect(grade(numeric(1000, { rtol: 0.01 }), r('1009'))).toBe(true);
  });
  it('rejects a value outside rtol', () => {
    expect(grade(numeric(1000, { rtol: 0.01 }), r('1011'))).toBe(false);
  });
  it('passes when either tol or rtol is satisfied', () => {
    const item = numeric(100, { tol: 5, rtol: 0.01 });
    expect(grade(item, r('104'))).toBe(true); // tol passes, rtol fails
    expect(grade(item, r('106'))).toBe(false); // both fail
    expect(grade(numeric(1000, { tol: 1, rtol: 0.01 }), r('1009'))).toBe(true); // rtol passes, tol fails
  });
  it('handles negative answers', () => {
    expect(grade(numeric(-2, { tol: 0.1 }), r('-2.05'))).toBe(true);
    expect(grade(numeric(-2), r('2'))).toBe(false);
  });
  it('rejects non-numeric input', () => {
    expect(grade(numeric(0), r('abc'))).toBe(false);
  });
  it('rejects empty and whitespace-only input even when the answer is 0', () => {
    expect(grade(numeric(0), r(''))).toBe(false);
    expect(grade(numeric(0), r('   '))).toBe(false);
  });
  it('rejects NaN and Infinity', () => {
    expect(grade(numeric(0, { tol: 1e9 }), r('NaN'))).toBe(false);
    expect(grade(numeric(0, { rtol: 1 }), r('Infinity'))).toBe(false);
  });
});

describe('normalizeOutput', () => {
  it('converts CRLF to LF', () => {
    expect(normalizeOutput('a\r\nb')).toBe('a\nb');
  });
  it('trims trailing whitespace on each line', () => {
    expect(normalizeOutput('a  \nb\t')).toBe('a\nb');
  });
  it('trims leading and trailing blank space of the whole string', () => {
    expect(normalizeOutput('\n\n  a\nb\n\n')).toBe('a\nb');
  });
  it('collapses runs of spaces and tabs within a line', () => {
    expect(normalizeOutput('a   b\t\tc \t d')).toBe('a b c d');
  });
  it('leaves an empty string empty', () => {
    expect(normalizeOutput('')).toBe('');
  });
});

describe('grade: output', () => {
  const r = (value: string) => ({ type: 'output' as const, value });
  it('matches identical output', () => {
    expect(grade(output('[1, 2]\nTrue'), r('[1, 2]\nTrue'))).toBe(true);
  });
  it('ignores whitespace differences and CRLF', () => {
    expect(grade(output('[1, 2]\nTrue'), r('  [1,   2]  \r\nTrue\r\n'))).toBe(true);
  });
  it('is case-sensitive', () => {
    expect(grade(output('True'), r('true'))).toBe(false);
  });
  it('rejects different output', () => {
    expect(grade(output('3'), r('4'))).toBe(false);
  });
  it('rejects empty input for non-empty output', () => {
    expect(grade(output('3'), r(''))).toBe(false);
  });
});

describe('grade: order', () => {
  const r = (o: string[]) => ({ type: 'order' as const, order: o });
  it('is correct for the exact authored sequence', () => {
    expect(grade(order, r(['first', 'second', 'third']))).toBe(true);
  });
  it('is wrong for any other sequence', () => {
    expect(grade(order, r(['second', 'first', 'third']))).toBe(false);
    expect(grade(order, r(['third', 'second', 'first']))).toBe(false);
  });
  it('is wrong when items are missing or extra', () => {
    expect(grade(order, r(['first', 'second']))).toBe(false);
    expect(grade(order, r(['first', 'second', 'third', 'fourth']))).toBe(false);
  });
});

describe('grade: cloze', () => {
  const r = (value: string) => ({ type: 'cloze' as const, value });
  const acc = cloze({ accept: ['gradient', 'grad'] });
  it('matches any accept entry', () => {
    expect(grade(acc, r('gradient'))).toBe(true);
    expect(grade(acc, r('grad'))).toBe(true);
  });
  it('matches accept entries case-insensitively and trimmed', () => {
    expect(grade(acc, r('  GrAdIeNt  '))).toBe(true);
  });
  it('rejects a non-matching answer', () => {
    expect(grade(acc, r('gradients descent'))).toBe(false);
  });
  it('matches a regex case-insensitively', () => {
    expect(grade(cloze({ regex: '^soft ?max$' }), r('SoftMax'))).toBe(true);
    expect(grade(cloze({ regex: '^soft ?max$' }), r('soft max'))).toBe(true);
  });
  it('does not add anchors to the regex', () => {
    expect(grade(cloze({ regex: 'max' }), r('softmax'))).toBe(true);
    expect(grade(cloze({ regex: '^max$' }), r('softmax'))).toBe(false);
  });
  it('passes when either accept or regex matches', () => {
    const both = cloze({ accept: ['relu'], regex: '^sigmoid$' });
    expect(grade(both, r('ReLU'))).toBe(true);
    expect(grade(both, r('sigmoid'))).toBe(true);
    expect(grade(both, r('tanh'))).toBe(false);
  });
  it('rejects empty and whitespace-only input, even with a permissive regex', () => {
    expect(grade(acc, r(''))).toBe(false);
    expect(grade(cloze({ regex: '.*' }), r(''))).toBe(false);
    expect(grade(cloze({ regex: '.*' }), r('   '))).toBe(false);
  });
});

describe('grade: mismatched response type', () => {
  it('returns false when the response type does not match the item type', () => {
    expect(grade(mcq, { type: 'cloze', value: 'b' })).toBe(false);
  });
});
