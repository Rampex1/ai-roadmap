// Roadmap layout and module status (design §5.2).
import type { State } from './progress';

export type ModuleNode = { id: string; course: string; order: number; prereqs: string[] };

/** Layer = longest prerequisite path from a root. Throws on a cycle. */
export function layers(modules: ModuleNode[]): Record<string, number> {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const out: Record<string, number> = {};
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    if (id in out) return out[id];
    if (visiting.has(id)) throw new Error(`prereq cycle involving "${id}"`);
    visiting.add(id);
    const pre = (byId.get(id)?.prereqs ?? []).filter((p) => byId.has(p));
    const layer = pre.length ? 1 + Math.max(...pre.map(visit)) : 0;
    visiting.delete(id);
    return (out[id] = layer);
  };
  modules.forEach((m) => visit(m.id));
  return out;
}

export function moduleStatus(
  m: ModuleNode,
  state: State,
  lessonCount: number,
  lessonsDone: number,
): 'mastered' | 'in-progress' | 'available' | 'prereqs-missing' {
  if (state.mastery[m.id]?.mastered) return 'mastered';
  if (lessonsDone > 0) return 'in-progress';
  return m.prereqs.every((p) => state.mastery[p]?.mastered) ? 'available' : 'prereqs-missing';
}
