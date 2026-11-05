import { expect, it } from 'vitest';
import { dictationWords, glossaryPrompt, MAX_WORDS, normalizeWords } from '../../src/shared/custom-words';

it('a dictation listens for the wake words first, so a full list never drops them', () => {
  const full = Array.from({ length: MAX_WORDS }, (_, i) => `word${i}`);
  expect(dictationWords(full, ['Pixie'])[0]).toBe('Pixie');
  expect(dictationWords(full, ['Pixie'])).toHaveLength(MAX_WORDS);
  expect(dictationWords(['pixie', 'Supabase'], ['Pixie'])).toEqual(['Pixie', 'Supabase']);
  expect(dictationWords(['Supabase'], [])).toEqual(['Supabase']);
});

it('trims, strips characters Scribe refuses and dedupes ignoring case', () => {
  expect(normalizeWords(['  Muaad ', 'supabase', 'Supabase', '', 'a{b}c'])).toEqual(['Muaad', 'supabase', 'abc']);
});

it('collapses inner spaces', () => {
  expect(normalizeWords(['New   York'])).toEqual(['New York']);
});

it('drops entries over 5 words or 50 characters', () => {
  expect(normalizeWords(['one two three four five six'])).toEqual([]);
  expect(normalizeWords(['x'.repeat(51)])).toEqual([]);
  expect(normalizeWords(['one two three four five'])).toEqual(['one two three four five']);
});

it('keeps at most 50', () => {
  expect(MAX_WORDS).toBe(50);
  expect(normalizeWords(Array.from({ length: 60 }, (_, i) => `w${i}`))).toHaveLength(50);
});

it('builds the Whisper prompt only when there are words', () => {
  expect(glossaryPrompt([])).toBeNull();
  expect(glossaryPrompt(['Muaad', 'Pixie'])).toBe('Glossary: Muaad, Pixie.');
});
