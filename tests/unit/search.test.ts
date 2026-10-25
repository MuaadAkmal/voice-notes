import { expect, it } from 'vitest';
import type { Note, Page } from '../../src/shared/channels';
import { itemId, type Item } from '../../src/shared/items';
import { distinctShows, filterItems, filterNotes, isFiltering, NO_FILTER } from '../../src/shared/search';

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
  transcript: null,
  transcriptLang: null,
  transcribedAt: null,
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

const page = (id: string, over: Partial<Page> = {}): Page => ({
  id,
  title: id,
  body: '',
  folderId: null,
  starred: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const items: Item[] = [
  { type: 'audio', note: note('a', { title: 'hola', show: 'Dark', source: 'system' }) },
  { type: 'page', page: page('p1', { title: 'Shopping', body: '¿Qué pasó? hoy' }) },
  { type: 'page', page: page('p2', { title: 'Ideas', starred: true }) },
];
const itemIds = (is: Item[]) => is.map(itemId);

it('filterItems matches page title and body, ignoring accents', () => {
  expect(itemIds(filterItems(items, { ...NO_FILTER, query: 'que paso' }))).toEqual(['p1']);
  expect(itemIds(filterItems(items, { ...NO_FILTER, query: 'shopping hoy' }))).toEqual(['p1']);
  expect(itemIds(filterItems(items, { ...NO_FILTER, query: 'ideas' }))).toEqual(['p2']);
  expect(itemIds(filterItems(items, NO_FILTER))).toEqual(['a', 'p1', 'p2']);
});

it('filterItems applies starred to pages', () => {
  expect(itemIds(filterItems(items, { ...NO_FILTER, starred: true }))).toEqual(['p2']);
});

it('filterItems excludes pages when a show or source filter is set', () => {
  expect(itemIds(filterItems(items, { ...NO_FILTER, show: 'Dark' }))).toEqual(['a']);
  expect(itemIds(filterItems(items, { ...NO_FILTER, source: 'system' }))).toEqual(['a']);
  expect(itemIds(filterItems(items, { ...NO_FILTER, source: 'mic' }))).toEqual([]);
});

it('filterItems ignores image urls and link destinations in page bodies', () => {
  const uuid = '0123456789abcdef0123456789abcdef0123';
  const withMedia: Item[] = [
    { type: 'page', page: page('img', { body: `![cat](vn-image://${uuid}.png)` }) },
    { type: 'page', page: page('lnk', { body: '[site](https://example.com)' }) },
  ];
  const find = (query: string) => itemIds(filterItems(withMedia, { ...NO_FILTER, query }));
  expect(find('png')).toEqual([]);
  expect(find('vn-image')).toEqual([]);
  expect(find('0123456789')).toEqual([]);
  expect(find('cat')).toEqual([]);
  expect(find('site')).toEqual(['lnk']);
  expect(find('example')).toEqual([]);
});

it('distinctShows lists each show once, sorted, with counts', () => {
  expect(distinctShows(notes)).toEqual([
    { show: 'Dark', count: 1 },
    { show: 'La Casa de Papel', count: 2 },
  ]);
});

it('matches words in the transcript', () => {
  const withTranscript = note('t', { title: 'Note', transcript: '¿Qué pasó ayer?' });
  const q = { ...NO_FILTER, query: 'que paso' };
  expect(ids(filterNotes([withTranscript, note('u')], q))).toEqual(['t']);
  const items: Item[] = [{ type: 'audio', note: withTranscript }, { type: 'audio', note: note('u') }];
  expect(filterItems(items, q).map(itemId)).toEqual([itemId(items[0])]);
});
