export type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataBytes: number;
  seconds: number;
};

/** Header facts of a 16-bit PCM WAV (walks chunks to `data`), else null. */
export function wavInfo(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 12) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt: { sampleRate: number; channels: number; bits: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) return null;
      if (v.getUint16(body, true) !== 1) return null;
      fmt = {
        channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        bits: v.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt || fmt.bits !== 16 || fmt.channels < 1 || fmt.sampleRate < 1)
        return null;
      const frame = fmt.channels * 2;
      const avail = Math.min(size, bytes.length - body);
      const dataBytes = avail - (avail % frame);
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bitsPerSample: 16,
        dataOffset: body,
        dataBytes,
        seconds: dataBytes / (fmt.sampleRate * frame),
      };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** Seconds billed for a clip: whole seconds, at least 1. */
export const chargedSeconds = (seconds: number): number =>
  Math.max(1, Math.ceil(seconds));
