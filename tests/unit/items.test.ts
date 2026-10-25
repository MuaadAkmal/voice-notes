import { expect, it } from 'vitest';
import type { Note, Page } from '../../src/shared/channels';
import {
  itemFolderId,
  itemId,
  itemStarred,
  itemTime,
  mergeItems,
  type Item,
} from '../../src/shared/items';

const T0 = 1_000_000;

const note = (
  id: string,
  createdAt: number,
  over: Partial<Note> = {},
): Note => ({
  id,
  title: id,
  filePath: `recordings/${id}.webm`,
  durationMs: 1000,
  sizeBytes: 1,
  mimeType: 'audio/webm',
  status: 'ok',
  createdAt,
  updatedAt: createdAt,
  syncedAt: null,
  folderId: null,
  source: 'mic',
  kind: 'note',
  windowTitle: null,
  show: null,
  starred: false,
  ...over,
});

const page = (
  id: string,
  updatedAt: number,
  over: Partial<Page> = {},
): Page => ({
  id,
  title: id,
  body: '',
  folderId: null,
  starred: false,
  createdAt: 0,
  updatedAt,
  ...over,
});

it('mergeItems interleaves notes and pages newest first', () => {
  const items = mergeItems(
    [note('n2', T0 + 2), note('n0', T0)],
    [page('p1', T0 + 1)],
  );
  expect(items.map((i) => [i.type, itemId(i)])).toEqual([
    ['audio', 'n2'],
    ['page', 'p1'],
    ['audio', 'n0'],
  ]);
});

it('mergeItems keeps notes before pages on a tie', () => {
  const items = mergeItems([note('n', T0)], [page('p', T0)]);
  expect(items.map(itemId)).toEqual(['n', 'p']);
});

it('itemTime uses createdAt for audio and updatedAt for pages', () => {
  const a: Item = { type: 'audio', note: note('n', 5, { updatedAt: 9 }) };
  const p: Item = { type: 'page', page: page('p', 7) };
  expect(itemTime(a)).toBe(5);
  expect(itemTime(p)).toBe(7);
});

it('itemFolderId and itemStarred read the right field for both types', () => {
  const a: Item = {
    type: 'audio',
    note: note('n', 1, { folderId: 'f1', starred: true }),
  };
  const p: Item = {
    type: 'page',
    page: page('p', 1, { folderId: 'f2', starred: false }),
  };
  expect(itemFolderId(a)).toBe('f1');
  expect(itemFolderId(p)).toBe('f2');
  expect(itemStarred(a)).toBe(true);
  expect(itemStarred(p)).toBe(false);
});
