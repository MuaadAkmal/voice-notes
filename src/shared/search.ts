import type { Note, RecordingSource } from './channels';
import type { Item } from './items';

export type SourceFilter = RecordingSource | 'rewind';
export type NoteFilter = { query: string; show: string | null; source: SourceFilter | null; starred: boolean };

export const NO_FILTER: NoteFilter = { query: '', show: null, source: null, starred: false };

/** Lower-case and strip accents, so "que paso" finds "¿Qué pasó?". */
export const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Where the query's words occur in `text`, matched like the search (accent- and case-insensitive), as
 * merged [start, end) ranges of `text`, for highlighting.
 */
export function matchRanges(text: string, query: string): [number, number][] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  // Normalised text, plus the original index each of its UTF-16 units came from.
  let flat = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const n = normalize(ch);
    flat += n;
    for (let k = 0; k < n.length; k++) origin.push(i);
    i += ch.length;
  }
  const found: [number, number][] = [];
  for (const w of words) {
    for (let at = flat.indexOf(w); at !== -1; at = flat.indexOf(w, at + 1)) {
      const last = origin[at + w.length - 1];
      found.push([origin[at], last + String.fromCodePoint(text.codePointAt(last)!).length]);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of found) {
    const prev = merged.at(-1);
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

export const isFiltering = (f: NoteFilter) => f.query.trim() !== '' || f.show !== null || f.source !== null || f.starred;

/** Every word of the query must appear in the title, show, window title or transcript; the other filters must all hold. */
export function filterNotes(notes: Note[], f: NoteFilter): Note[] {
  const words = normalize(f.query).split(/\s+/).filter(Boolean);
  return notes.filter((n) => {
    if (f.starred && !n.starred) return false;
    if (f.show !== null && n.show !== f.show) return false;
    if (f.source === 'rewind' ? n.kind !== 'rewind' : f.source !== null && n.source !== f.source) return false;
    if (words.length === 0) return true;
    const haystack = normalize([n.title, n.show, n.windowTitle, n.transcript].filter(Boolean).join(' '));
    return words.every((w) => haystack.includes(w));
  });
}

/** Searchable text of a page body: images dropped entirely, links reduced to their text. */
const searchableBody = (body: string) => body.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/** Like filterNotes over the merged list. Pages have no show or source, so those filters exclude them. */
export function filterItems(items: Item[], f: NoteFilter): Item[] {
  const words = normalize(f.query).split(/\s+/).filter(Boolean);
  const audio = new Set(
    filterNotes(
      items.flatMap((i) => (i.type === 'audio' ? [i.note] : [])),
      f,
    ),
  );
  return items.filter((i) => {
    if (i.type === 'audio') return audio.has(i.note);
    if (f.show !== null || f.source !== null) return false;
    if (f.starred && !i.page.starred) return false;
    const haystack = normalize(`${i.page.title} ${searchableBody(i.page.body)}`);
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
