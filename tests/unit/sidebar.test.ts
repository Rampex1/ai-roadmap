import { describe, it, expect } from 'vitest';
import { courseOf, filterSidebar } from '@/lib/sidebar';

const group = (label: string, href: string) => ({ type: 'group', label, entries: [{ type: 'link', label: 'x', href, isCurrent: false }] });

describe('courseOf', () => {
  it('maps lesson and module paths to their course slug', () => {
    expect(courseOf('/foundations/f0/welcome/')).toBe('foundations');
    expect(courseOf('/llm/c1/')).toBe('llm');
    expect(courseOf('/mle')).toBe('mle');
  });
  it('returns null outside a course', () => {
    expect(courseOf('/')).toBeNull();
    expect(courseOf('/roadmap/')).toBeNull();
  });
});

describe('filterSidebar', () => {
  const sidebar = [group('Foundations', '/foundations/f0/welcome/'), group('LLM Engineering', '/llm/c1/intro/')];
  it('keeps only the group whose links belong to the current course', () => {
    const out = filterSidebar(sidebar, '/llm/c1/intro/');
    expect(out.map((g) => g.label)).toEqual(['LLM Engineering']);
  });
  it('keeps everything outside a course', () => {
    expect(filterSidebar(sidebar, '/roadmap/')).toHaveLength(2);
  });
});
