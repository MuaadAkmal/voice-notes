import { expect, it } from 'vitest';
import { encodeWav, silentWav } from '../../src/shared/wav';

const ascii = (b: Uint8Array, from: number) =>
  String.fromCharCode(...b.slice(from, from + 4));

it('encodes 16-bit mono PCM with a 44-byte header', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
  expect(wav.length).toBe(44 + 8);
  expect(ascii(wav, 0)).toBe('RIFF');
  expect(ascii(wav, 8)).toBe('WAVE');
  expect(ascii(wav, 12)).toBe('fmt ');
  expect(ascii(wav, 36)).toBe('data');
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  expect(v.getUint32(4, true)).toBe(36 + 8);
  expect(v.getUint16(22, true)).toBe(1);
  expect(v.getUint32(24, true)).toBe(16000);
  expect(v.getUint32(28, true)).toBe(32000);
  expect(v.getUint16(32, true)).toBe(2);
  expect(v.getUint16(34, true)).toBe(16);
  expect(v.getUint32(40, true)).toBe(8);
  expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([
    0, 32767, -32768, 16384,
  ]);
});

it('clamps out-of-range samples', () => {
  const wav = encodeWav(new Float32Array([2, -3]), 16000);
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  expect([v.getInt16(44, true), v.getInt16(46, true)]).toEqual([32767, -32768]);
});

it('makes silent clips', () => {
  const wav = silentWav(1);
  expect(wav.length).toBe(44 + 32000);
  expect(wav.slice(44).every((b) => b === 0)).toBe(true);
});
