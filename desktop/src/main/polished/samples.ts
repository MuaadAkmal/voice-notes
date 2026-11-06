import { CLONE_MAX_SECONDS } from '../../shared/asr/protocol';
import type { Note } from '../../shared/channels';

// The recordings a voice clone is made from: the user's own voice, on this PC.

/** Longest mic notes first, until their total reaches `targetMs` (or the clone's 180 s). */
export function pickSamples(notes: Note[], targetMs = 120_000): Note[] {
  const goal = Math.min(targetMs, CLONE_MAX_SECONDS * 1000);
  const mine = notes
    .filter((n) => n.kind === 'note' && n.source === 'mic' && n.status === 'ok' && !n.pageId)
    .sort((a, b) => b.durationMs - a.durationMs);
  const out: Note[] = [];
  let total = 0;
  for (const n of mine) {
    if (total >= goal) break;
    out.push(n);
    total += n.durationMs;
  }
  return out;
}

const HEADER = 44;

/** WAVs from `toWav` (16 kHz mono 16-bit) as one, cut at `maxSeconds`. */
export function joinWavs(wavs: Uint8Array[], maxSeconds = CLONE_MAX_SECONDS): Uint8Array {
  const rate = wavs.length ? new DataView(wavs[0].buffer, wavs[0].byteOffset).getUint32(24, true) : 16000;
  let room = Math.floor(maxSeconds * rate) * 2;
  const parts: Uint8Array[] = [];
  for (const w of wavs) {
    if (room <= 0) break;
    const data = w.subarray(HEADER, HEADER + Math.min(w.length - HEADER, room));
    parts.push(data);
    room -= data.length;
  }
  const dataBytes = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(HEADER + dataBytes);
  if (wavs.length) out.set(wavs[0].subarray(0, HEADER));
  const v = new DataView(out.buffer);
  v.setUint32(4, 36 + dataBytes, true);
  v.setUint32(40, dataBytes, true);
  let at = HEADER;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
