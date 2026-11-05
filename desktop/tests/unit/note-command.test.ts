import { expect, it } from 'vitest';
import { parseNoteCommand, soundKey } from '../../src/shared/note-command';

const q = (s: string, words?: string[]) => parseNoteCommand(s, words)?.text ?? null;

it('Pixie by default, with Whisper punctuation stripped', () => {
  expect(q('Pixie, add blueberry to my grocery list.')).toBe('add blueberry to my grocery list');
  expect(q(' pixie: add كيف الحال يا صديقي to Arabic phrases')).toBe('add كيف الحال يا صديقي to Arabic phrases');
  expect(q('"Pixie - this video to YouTube"')).toBe('this video to YouTube');
});

it('accepts spellings that sound the same, and an optional Hey', () => {
  expect(q('Pixy, buy stamps')).toBe('buy stamps');
  expect(q('Pixi buy stamps')).toBe('buy stamps');
  expect(q('Hey Pixie, buy stamps')).toBe('buy stamps');
  expect(q('Okay, Pixie. Buy stamps.')).toBe('Buy stamps');
});

it('leaves ordinary dictation alone', () => {
  expect(q('Note this down for later')).toBeNull();
  expect(q('Not sure about that')).toBeNull();
  expect(q('Pixel 9 is out')).toBeNull();
  expect(q('Hey there, how are you')).toBeNull();
  expect(q('I asked Pixie to buy stamps')).toBeNull();
  expect(q('Pixie.')).toBeNull();
  expect(q('')).toBeNull();
});

it('uses the user’s own names, single or several words', () => {
  const words = ['Ziggy', 'Captain Mango'];
  expect(q('Ziggie, milk to groceries', words)).toBe('milk to groceries');
  expect(q('Captain mango add eggs', words)).toBe('add eggs');
  expect(q('Hey Captain Mango, add eggs', words)).toBe('add eggs');
  expect(q('Pixie, milk', words)).toBeNull();
  expect(q('Captain, add eggs', words)).toBeNull();
});

it('an empty list falls back to Pixie', () => {
  expect(q('Pixie, milk', [])).toBe('milk');
});

it('soundKey folds common spellings together', () => {
  expect(soundKey('Pixie')).toBe(soundKey('Pixy'));
  expect(soundKey('Ziggy')).toBe(soundKey('Ziggie'));
  expect(soundKey('Koda')).toBe(soundKey('Coda'));
  expect(soundKey('Pixel')).not.toBe(soundKey('Pixie'));
});

const near = (s: string, words?: string[], pageTitles: string[] = ['Spanish', 'Arabic', 'Grocery list']) =>
  parseNoteCommand(s, words, { pageTitles })?.text ?? null;

it('a name one sound off counts when the rest is a command (heard as Dixie for Pixie)', () => {
  expect(near('Dixie, add the word "cómo estás" to Spanish.')).toBe('add the word "cómo estás" to Spanish');
  expect(near('Dixie, I learned a new word in Arabic called "jawaan".')).toBe('I learned a new word in Arabic called "jawaan');
  expect(near('Bixie milk and eggs for the grocery list')).toBe('milk and eggs for the grocery list');
});

it('a near miss followed by ordinary speech still pastes', () => {
  expect(near('Dixie Chicks were great last night')).toBeNull();
  expect(near('Fixing I learned a new word')).toBeNull();
  expect(near('If you add this page to Reddit')).toBeNull();
  expect(near('Pixel phones add a lot of value')).toBeNull(); // two sounds off
});

it('short names only ever match exactly', () => {
  expect(near('Sir, add milk to the grocery list', ['Siri'])).toBeNull();
  expect(near('Siri, add milk to the grocery list', ['Siri'])).toBe('add milk to the grocery list');
});

it('without page titles there is no near match', () => {
  expect(q('Dixie, add milk')).toBeNull();
});
