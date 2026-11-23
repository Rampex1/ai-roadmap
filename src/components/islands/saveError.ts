import type { SaveResult } from '@/lib/progress';

export function saveErrorText(r: SaveResult): string | null {
  if (r.ok) return null;
  if (r.error === 'quota') return 'Browser storage is full, so this was not saved. Export your progress from Settings, then free some space.';
  if (r.error === 'corrupt') return 'Saved progress could not be read, so saving is paused to protect it. Open Settings to restore a backup or reset.';
  return 'Browser storage is unavailable (private browsing?), so progress cannot be saved.';
}
