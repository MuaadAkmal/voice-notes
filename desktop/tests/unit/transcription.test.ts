import { expect, it } from 'vitest';
import {
  cleanTranscript,
  LANGUAGE_CODES,
  normaliseBaseUrl,
  normaliseLanguage,
  sendsKeyInsecurely,
  TRANSCRIBE_LANGUAGES,
} from '../../src/shared/transcription';

it('normalises base URLs', () => {
  expect(normaliseBaseUrl('  https://vm.example.com/v1/  ')).toBe(
    'https://vm.example.com/v1',
  );
  expect(normaliseBaseUrl('https://vm.example.com')).toBe(
    'https://vm.example.com',
  );
  expect(
    normaliseBaseUrl('https://vm.example.com/v1/audio/transcriptions'),
  ).toBe('https://vm.example.com/v1');
  expect(normaliseBaseUrl('http://localhost:8000/v1')).toBe(
    'http://localhost:8000/v1',
  );
  expect(normaliseBaseUrl('https://vm.example.com/v1?x=1#y')).toBe(
    'https://vm.example.com/v1',
  );
  expect(normaliseBaseUrl('')).toBeNull();
  expect(normaliseBaseUrl('ftp://x/v1')).toBeNull();
  expect(normaliseBaseUrl('not a url')).toBeNull();
});

it('normalises languages', () => {
  expect(normaliseLanguage('es')).toBe('es');
  expect(normaliseLanguage('ES')).toBe('es');
  expect(normaliseLanguage('spanish')).toBe('es');
  expect(normaliseLanguage('Spanish')).toBe('es');
  expect(normaliseLanguage('sv')).toBe('sv'); // any two-letter code is kept
  expect(normaliseLanguage('swedish')).toBeNull(); // name not in the table
  expect(normaliseLanguage(undefined)).toBeNull();
  expect(normaliseLanguage(3)).toBeNull();
});

it('flags keys sent over plain http to remote hosts', () => {
  expect(sendsKeyInsecurely('http://203.0.113.5:8000/v1')).toBe(true);
  expect(sendsKeyInsecurely('http://localhost:8000/v1')).toBe(false);
  expect(sendsKeyInsecurely('http://127.0.0.1:8000/v1')).toBe(false);
  expect(sendsKeyInsecurely('http://[::1]:8000/v1')).toBe(false);
  expect(sendsKeyInsecurely('https://vm.example.com/v1')).toBe(false);
});

it('lists 15 languages, English first', () => {
  expect(TRANSCRIBE_LANGUAGES).toHaveLength(15);
  expect(TRANSCRIBE_LANGUAGES[0]).toEqual({ code: 'en', name: 'English' });
  expect(LANGUAGE_CODES[0]).toBe('auto');
  expect(LANGUAGE_CODES).toHaveLength(16);
});
