import { MAX_BYTES, MAX_SECONDS, type TranscribeResponse, type UsageResponse } from './protocol.ts';
import type { AsrStore } from './store.ts';
import { chargedSeconds, wavInfo } from './wav-info.ts';

// The rules of cloud transcription: check the clip, reserve its seconds against the month's cap,
// transcribe, and give the seconds back if the provider fails. The reservation and the provider run
// side by side: the reservation is a slow fresh connection (about 1 s) that waiting for first added
// to every dictation. Past the cap the provider call is cancelled the moment the answer is in, and
// nothing comes back to the caller.

export class BadAudio extends Error {}
export class TooLarge extends Error {}
export class QuotaExceeded extends Error {
  constructor(readonly resetsAt: string) {
    super('quota exceeded');
  }
}
export class ProviderFailed extends Error {}

/** clean: leave out filler words and false starts. */
export type Transcriber = (
  wav: Uint8Array,
  language: string | null,
  opts: { clean: boolean; signal: AbortSignal },
) => Promise<{ text: string; language: string | null }>;

/** 'YYYY-MM-01' of the UTC month of `t`, and the start of the next month as ISO. */
export function periodOf(t: number): { period: string; resetsAt: string } {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    period: `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-01`,
    resetsAt: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
  };
}

/** A 44-byte PCM 16-bit header followed by `pcm`. */
export function canonicalWav(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const tag = (at: number, t: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = t.charCodeAt(i);
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export class AsrCore {
  constructor(private readonly d: { store: AsrStore; transcribe: Transcriber; now: () => number }) {}

  async transcribe(user: string, body: Uint8Array, language: string | null, clean = false): Promise<TranscribeResponse> {
    if (body.length > MAX_BYTES) throw new TooLarge('body too large');
    const info = wavInfo(body);
    if (!info || info.dataBytes <= 0) throw new BadAudio('not a 16-bit PCM WAV');
    if (info.sampleRate < 8000 || info.sampleRate > 48000 || info.channels > 2) throw new BadAudio('unsupported format');
    if (info.seconds > MAX_SECONDS) throw new TooLarge('clip too long');
    // Forward only what was measured and charged: a fresh header over exactly the data chunk's bytes.
    const wav = canonicalWav(body.subarray(info.dataOffset, info.dataOffset + info.dataBytes), info.sampleRate, info.channels);
    const seconds = chargedSeconds(info.seconds);
    const { period, resetsAt } = periodOf(this.d.now()); // once: a refund goes back to this same month
    const t0 = this.d.now();
    const ms: { reserve?: number; provider?: number } = {};
    const cancel = new AbortController();
    // Settled either way, so a provider failure can't go unhandled while the reservation is awaited.
    const provider = this.d.transcribe(wav, language, { clean, signal: cancel.signal }).then(
      (out) => ({ ok: true as const, out }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    void provider.finally(() => (ms.provider = this.d.now() - t0));
    let r: Awaited<ReturnType<AsrStore['reserve']>>;
    try {
      r = await this.d.store.reserve(user, period, seconds);
    } catch (e) {
      cancel.abort();
      throw e;
    }
    ms.reserve = this.d.now() - t0;
    if (!r.ok) {
      cancel.abort();
      throw new QuotaExceeded(resetsAt);
    }
    const done = await provider;
    if (!done.ok) {
      try {
        await this.d.store.refund(user, period, seconds);
      } catch (re) {
        console.error('[asr] refund', re);
      }
      throw new ProviderFailed(done.error instanceof Error ? done.error.message : 'provider failed');
    }
    ms.provider ??= this.d.now() - t0;
    return { text: done.out.text, language: done.out.language, seconds, used: r.used, limit: r.limit, resetsAt, ms };
  }

  async usage(user: string): Promise<UsageResponse> {
    const { period, resetsAt } = periodOf(this.d.now());
    const u = await this.d.store.usage(user, period);
    return { used: u.used, limit: u.limit, resetsAt, plan: u.plan };
  }
}
