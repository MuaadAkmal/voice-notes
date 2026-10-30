import { describe, expect, it } from 'vitest';
import { matchFolderCommand } from '../../src/shared/folder-command';
import { encodeWav, trimWav } from '../../src/shared/wav';

const folders = [
  { id: 'm', name: 'Movie' },
  { id: 'ml', name: 'Movie lines' },
  { id: 'es', name: 'Spanish' },
];
const match = (t: string) => matchFolderCommand(t, ['Pixie'], folders)?.id ?? null;

describe('matchFolderCommand', () => {
  it('files by the name after the wake word', () => {
    expect(match('Pixie, movie lines. I am Groot.')).toBe('ml');
    expect(match('Hey Pixy, Spanish. ¿Dónde está?')).toBe('es');
    expect(match('Pixie to Spanish, hola')).toBe('es');
  });
  it('prefers the longest name', () => {
    expect(match('Pixie movie lines I am')).toBe('ml');
    expect(match('Pixie movie, great one')).toBe('m');
  });
  it('null without the wake word or a known folder', () => {
    expect(match('Spanish hola')).toBeNull();
    expect(match('Pixie, French bonjour')).toBeNull();
    expect(match('Pixel, Spanish hola')).toBeNull();
  });
});

describe('trimWav', () => {
  it('keeps the first seconds with a valid header', () => {
    const wav = trimWav(encodeWav(new Float32Array(16000 * 10), 16000), 4);
    const v = new DataView(wav.buffer);
    expect(wav.length).toBe(44 + 16000 * 4 * 2);
    expect(v.getUint32(40, true)).toBe(16000 * 4 * 2);
    expect(trimWav(encodeWav(new Float32Array(100), 16000), 4).length).toBe(244);
  });
});
