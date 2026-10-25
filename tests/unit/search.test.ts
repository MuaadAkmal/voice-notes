import { expect, it } from 'vitest';
import type { Note } from '../../src/shared/channels';
import { distinctShows, filterNotes, isFiltering, NO_FILTER } from '../../src/shared/search';

const note = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  title: id,
  filePath: `recordings/${id}.webm`,
  durationMs: 1000,
  sizeBytes: 1,
  mimeType: 'audio/webm',
  status: 'ok',
  createdAt: 0,
  updatedAt: 0,
  syncedAt: null,
  folderId: null,
  source: 'mic',
  kind: 'note',
  windowTitle: null,
  show: null,
  starred: false,
  ...over,
});

const notes = [
  note('a', { title: '¿Qué pasó?', show: 'La Casa de Papel', windowTitle: 'La Casa de Papel | Netflix - Google Chrome' }),
  note('b', { title: 'gracias', show: 'Dark', starred: true, source: 'system', kind: 'rewind' }),
  note('c', { title: 'Voice note · 14:32', source: 'both' }),
  note('d', { title: 'tranquilo', show: 'La Casa de Papel', source: 'system' }),
];
const ids = (ns: Note[]) => ns.map((n) => n.id);

it('no filter keeps everything', () => {
  expect(ids(filterNotes(notes, NO_FILTER))).toEqual(['a', 'b', 'c', 'd']);
  expect(isFiltering(NO_FILTER)).toBe(false);
  expect(isFiltering({ ...NO_FILTER, query: '   ' })).toBe(false);
});

it('query matches title, show and window title, ignoring case and accents', () => {
  expect(ids(filterNotes(notes, { ...NO_FILTER, query: 'que paso' }))).toEqual(['a']);
  expect(ids(filterNotes(notes, { ...NO_FILTER, query: 'casa' }))).toEqual(['a', 'd']);
  expect(ids(filterNotes(notes, { ...NO_FILTER, query: 'netflix' }))).toEqual(['a']);
  expect(ids(filterNotes(notes, { ...NO_FILTER, query: 'casa tranq' }))).toEqual(['d']); // every word must match
  expect(isFiltering({ ...NO_FILTER, query: 'x' })).toBe(true);
});

it('filters by show, source, rewind and starred, combined', () => {
  expect(ids(filterNotes(notes, { ...NO_FILTER, show: 'La Casa de Papel' }))).toEqual(['a', 'd']);
  expect(ids(filterNotes(notes, { ...NO_FILTER, source: 'system' }))).toEqual(['b', 'd']);
  expect(ids(filterNotes(notes, { ...NO_FILTER, source: 'rewind' }))).toEqual(['b']);
  expect(ids(filterNotes(notes, { ...NO_FILTER, starred: true }))).toEqual(['b']);
  expect(ids(filterNotes(notes, { ...NO_FILTER, show: 'La Casa de Papel', source: 'system' }))).toEqual(['d']);
});

it('distinctShows lists each show once, sorted, with counts', () => {
  expect(distinctShows(notes)).toEqual([
    { show: 'Dark', count: 1 },
    { show: 'La Casa de Papel', count: 2 },
  ]);
});
