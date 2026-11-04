import { expect, it } from 'vitest';
import { AUDIO_LINE, audioLine, audioNoteId, orphanBlocks, referencedNotes, slashAudio } from '../../src/shared/audio-blocks';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const ID2 = '223e4567-e89b-42d3-a456-426614174000';

it('writes and reads a block line', () => {
  expect(audioLine(ID)).toBe(`[🎙 Voice note](note://${ID})`);
  expect(audioNoteId(audioLine(ID))).toBe(ID);
  expect(audioNoteId(`  [🎙 Idea](note://${ID})  `)).toBe(ID);
  expect(AUDIO_LINE.test(audioLine(ID))).toBe(true);
});

it('only a whole line is a block', () => {
  expect(audioNoteId(`see ${audioLine(ID)}`)).toBeNull();
  expect(audioNoteId(`[🎙 Voice note](note://not-an-id)`)).toBeNull();
  expect(audioNoteId(`[Voice note](note://${ID})`)).toBeNull();
});

it('/audio at the start of a line or after a space opens the recorder', () => {
  expect(slashAudio('/audio', 6)).toBe(true);
  expect(slashAudio('notes /audio', 12)).toBe(true);
  expect(slashAudio('foo/audio', 9)).toBe(false);
  expect(slashAudio('/audios', 7)).toBe(false);
  expect(slashAudio('/audio later', 6)).toBe(true);
  expect(slashAudio('/aud', 4)).toBe(false);
});

it('finds every note a page links to', () => {
  expect(referencedNotes([`a\n${audioLine(ID)}\n`, `x [🎙 b](note://${ID2}) y`, ''])).toEqual(new Set([ID, ID2]));
});

it('an owned note goes only once it has been seen unlinked for 10 minutes', () => {
  const t0 = 1_000_000_000;
  const old = { id: ID, pageId: 'p', createdAt: 0, status: 'ok' as const };
  let since = new Map<string, number>();
  // First seen unlinked (an hour-old note whose line was just deleted): only remembered.
  let r = orphanBlocks([old], new Set(), since, t0);
  expect(r.remove).toEqual([]);
  since = r.unlinkedSince;
  // Linked again (Ctrl+Z) before the next sweep: forgotten.
  r = orphanBlocks([old], new Set([ID]), since, t0 + 5 * 60_000);
  expect(r.unlinkedSince.size).toBe(0);
  // Unlinked across two sweeps 10 min apart: removed.
  r = orphanBlocks([old], new Set(), new Map(), t0);
  r = orphanBlocks([old], new Set(), r.unlinkedSince, t0 + 10 * 60_000 + 1);
  expect(r.remove).toEqual([ID]);
});

it('never removes ordinary notes, linked notes, or a recording this PC never had', () => {
  const since = new Map([[ID, 0], [ID2, 0], ['n3', 0]]);
  const notes = [
    { id: ID, pageId: null, createdAt: 0, status: 'ok' as const },
    { id: ID2, pageId: 'p', createdAt: 0, status: 'remote' as const }, // its page may not have arrived here yet
    { id: 'n3', pageId: 'p', createdAt: 0, status: 'ok' as const },
  ];
  expect(orphanBlocks(notes, new Set(['n3']), since, 10 ** 12).remove).toEqual([]);
});
