import { wavInfo } from './wav-info';

const SEARCH_S = 10; // look this far before each boundary
const WINDOW_S = 0.5; // quietest window of this length wins

function wrap(
  pcm: Uint8Array,
  rate: number,
  channels: number,
): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** Parts of at most `maxSeconds`, each a valid WAV, cut at the quietest spot just before each boundary. */
export function splitWav(bytes: Uint8Array, maxSeconds = 300): Uint8Array[] {
  const info = wavInfo(bytes);
  if (!info || info.seconds <= maxSeconds) return [bytes];
  const { sampleRate: rate, channels, dataOffset, dataBytes } = info;
  const frames = dataBytes / (channels * 2);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mag = (f: number) => {
    let sum = 0;
    for (let c = 0; c < channels; c++)
      sum += Math.abs(v.getInt16(dataOffset + (f * channels + c) * 2, true));
    return sum;
  };
  const max = Math.floor(maxSeconds * rate);
  const search = Math.floor(SEARCH_S * rate);
  const win = Math.max(1, Math.floor(WINDOW_S * rate));
  const parts: Uint8Array[] = [];
  const slice = (from: number, to: number) =>
    wrap(
      bytes.subarray(
        dataOffset + from * channels * 2,
        dataOffset + to * channels * 2,
      ),
      rate,
      channels,
    );
  let start = 0;
  while (frames - start > max) {
    const boundary = start + max;
    const first = Math.max(start, boundary - search);
    // rolling sum of |sample| over the window, only inside the search span
    let sum = 0;
    for (let f = first; f < Math.min(first + win, boundary); f++) sum += mag(f);
    let best = first;
    let bestSum = sum;
    for (let w = first + 1; w + win <= boundary; w++) {
      sum += mag(w + win - 1) - mag(w - 1);
      if (sum < bestSum) {
        bestSum = sum;
        best = w;
      }
    }
    const cut = Math.min(boundary, best + Math.floor(win / 2));
    parts.push(slice(start, cut));
    start = cut;
  }
  parts.push(slice(start, frames));
  return parts;
}
