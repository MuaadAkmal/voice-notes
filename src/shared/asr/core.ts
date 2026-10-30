import { MAX_BYTES, MAX_SECONDS, type TranscribeResponse, type UsageResponse } from './protocol';
import type { AsrStore } from './store';
import { chargedSeconds, wavInfo } from './wav-info';

// The rules of cloud transcription: check the clip, reserve its seconds against the month's cap
// before spending anything, transcribe, and give the seconds back if the provider fails.

export class BadAudio extends Error {}
export class TooLarge extends Error {}
export class QuotaExceeded extends Error {
  constructor(readonly resetsAt: string) {
    super('quota exceeded');
  }
}
export class ProviderFailed extends Error {}

export type Transcriber = (wav: Uint8Array, language: string | null) => Promise<{ text: string; language: string | null }>;

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

export class AsrCore {
  constructor(private readonly d: { store: AsrStore; transcribe: Transcriber; now: () => number }) {}

  async transcribe(user: string, body: Uint8Array, language: string | null): Promise<TranscribeResponse> {
    if (body.length > MAX_BYTES) throw new TooLarge('body too large');
    const info = wavInfo(body);
    if (!info || info.dataBytes <= 0) throw new BadAudio('not a 16-bit PCM WAV');
    if (info.seconds > MAX_SECONDS) throw new TooLarge('clip too long');
    const seconds = chargedSeconds(info.seconds);
    const { period, resetsAt } = periodOf(this.d.now()); // once: a refund goes back to this same month
    const r = await this.d.store.reserve(user, period, seconds);
    if (!r.ok) throw new QuotaExceeded(resetsAt);
    let out: { text: string; language: string | null };
    try {
      out = await this.d.transcribe(body, language);
    } catch (e) {
      await this.d.store.refund(user, period, seconds);
      throw new ProviderFailed(e instanceof Error ? e.message : 'provider failed');
    }
    return { text: out.text, language: out.language, seconds, used: r.used, limit: r.limit, resetsAt };
  }

  async usage(user: string): Promise<UsageResponse> {
    const { period, resetsAt } = periodOf(this.d.now());
    const u = await this.d.store.usage(user, period);
    return { used: u.used, limit: u.limit, resetsAt, plan: u.plan };
  }
}
