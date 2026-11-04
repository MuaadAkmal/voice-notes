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

it('an owned note nobody links to goes after 10 minutes', () => {
  const now = 1_000_000_000;
  const notes = [
    { id: ID, pageId: 'p', createdAt: now - 11 * 60_000 },
    { id: ID2, pageId: 'p', createdAt: now - 60_000 }, // just recorded: the line may be on its way, or undone
    { id: 'n3', pageId: null, createdAt: 0 }, // an ordinary note
    { id: 'n4', pageId: 'p', createdAt: 0 }, // still linked
  ];
  expect(orphanBlocks(notes, new Set(['n4']), now)).toEqual([ID]);
});
