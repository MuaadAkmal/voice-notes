import { expect, it } from 'vitest';
import { groupByDay } from '../../src/shared/format';
import type { Note, Page } from '../../src/shared/channels';

const note = (id: string, createdAt: number): Note => ({
  id,
  title: id,
  filePath: `recordings/${id}.webm`,
  durationMs: 1000,
  sizeBytes: 1,
  mimeType: 'audio/webm;codecs=opus',
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
});

it('groups notes by day, preserving input order within a group', () => {
  const now = new Date(2026, 9, 24, 15).getTime();
  const a = note('a', new Date(2026, 9, 24, 10).getTime());
  const b = note('b', new Date(2026, 9, 24, 9).getTime());
  const c = note('c', new Date(2026, 9, 23, 20).getTime());
  expect(groupByDay([a, b, c], now, (n) => n.createdAt)).toEqual([
    { label: 'Today', items: [a, b] },
    { label: 'Yesterday', items: [c] },
  ]);
});

it('groups pages by updatedAt', () => {
  const now = new Date(2026, 9, 24, 15).getTime();
  const page = (id: string, updatedAt: number): Page => ({
    id,
    title: id,
    body: '',
    folderId: null,
    starred: false,
    createdAt: 0,
    updatedAt,
  });
  const p = page('p', new Date(2026, 9, 24, 8).getTime());
  const q = page('q', new Date(2026, 9, 23, 8).getTime());
  expect(groupByDay([p, q], now, (x) => x.updatedAt)).toEqual([
    { label: 'Today', items: [p] },
    { label: 'Yesterday', items: [q] },
  ]);
});
