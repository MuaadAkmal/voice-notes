import type { Note, RecordingSource } from './channels';

export type SourceFilter = RecordingSource | 'rewind';
export type NoteFilter = { query: string; show: string | null; source: SourceFilter | null; starred: boolean };

export const NO_FILTER: NoteFilter = { query: '', show: null, source: null, starred: false };

/** Lower-case and strip accents, so "que paso" finds "¿Qué pasó?". */
export const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export const isFiltering = (f: NoteFilter) => f.query.trim() !== '' || f.show !== null || f.source !== null || f.starred;

/** Every word of the query must appear in the title, show or window title; the other filters must all hold. */
export function filterNotes(notes: Note[], f: NoteFilter): Note[] {
  const words = normalize(f.query).split(/\s+/).filter(Boolean);
  return notes.filter((n) => {
    if (f.starred && !n.starred) return false;
    if (f.show !== null && n.show !== f.show) return false;
    if (f.source === 'rewind' ? n.kind !== 'rewind' : f.source !== null && n.source !== f.source) return false;
    if (words.length === 0) return true;
    const haystack = normalize([n.title, n.show, n.windowTitle].filter(Boolean).join(' '));
    return words.every((w) => haystack.includes(w));
  });
}

export function distinctShows(notes: Note[]): { show: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of notes) if (n.show) counts.set(n.show, (counts.get(n.show) ?? 0) + 1);
  return [...counts]
    .map(([show, count]) => ({ show, count }))
    .sort((a, b) => a.show.localeCompare(b.show));
}
