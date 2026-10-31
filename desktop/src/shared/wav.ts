/** 16-bit PCM mono WAV: what every Whisper server can read. */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
  }
  return out;
}

export const silentWav = (seconds: number, sampleRate = 16000): Uint8Array =>
  encodeWav(new Float32Array(Math.round(seconds * sampleRate)), sampleRate);

/** The first `seconds` of a WAV from `encodeWav` (16-bit mono, 44-byte header). */
export function trimWav(wav: Uint8Array, seconds: number): Uint8Array {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const rate = v.getUint32(24, true);
  const dataBytes = Math.min(wav.length - 44, Math.floor(seconds * rate) * 2);
  const out = wav.slice(0, 44 + dataBytes);
  const o = new DataView(out.buffer);
  o.setUint32(4, 36 + dataBytes, true);
  o.setUint32(40, dataBytes, true);
  return out;
}
