import { expect, it } from 'vitest';
import { groupByDay } from '../../src/shared/format';
import type { Note } from '../../src/shared/channels';

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
});

it('groups notes by day, preserving input order within a group', () => {
  const now = new Date(2026, 9, 24, 15).getTime();
  const a = note('a', new Date(2026, 9, 24, 10).getTime());
  const b = note('b', new Date(2026, 9, 24, 9).getTime());
  const c = note('c', new Date(2026, 9, 23, 20).getTime());
  expect(groupByDay([a, b, c], now)).toEqual([
    { label: 'Today', notes: [a, b] },
    { label: 'Yesterday', notes: [c] },
  ]);
});
