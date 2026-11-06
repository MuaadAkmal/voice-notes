import { ProviderFailed } from './core.ts';
import { STOCK_VOICES } from './protocol.ts';
import type { Speaker } from './speak.ts';

// The Voice tab's samples: each stock voice says its own name once, made by the same text-to-speech
// as polished audio and kept. They are ours, so they never count against anyone's Cloud minutes.

/** The id is not a stock voice. */
export class UnknownVoice extends Error {}

export type SampleStore = {
  get(voiceId: string): Promise<Uint8Array | null>;
  put(voiceId: string, mp3: Uint8Array): Promise<void>;
};

const TIMEOUT_MS = 120_000;

export class SampleCore {
  private readonly making = new Map<string, Promise<Uint8Array>>();

  constructor(private readonly d: { store: SampleStore; speaker: Speaker }) {}

  /** The MP3 of a stock voice: kept, else made now (once, however many ask at the same time). */
  sample(voiceId: string): Promise<Uint8Array> {
    const voice = STOCK_VOICES.find((v) => v.id === voiceId);
    if (!voice) return Promise.reject(new UnknownVoice('unknown voice'));
    const busy = this.making.get(voiceId);
    if (busy) return busy;
    const p = this.load(voice).finally(() => this.making.delete(voiceId));
    this.making.set(voiceId, p);
    return p;
  }

  private async load(voice: { id: string; name: string }): Promise<Uint8Array> {
    const kept = await this.d.store.get(voice.id);
    if (kept && kept.length) return kept;
    let mp3: Uint8Array;
    try {
      mp3 = await this.d.speaker(voice.id, `Hi, I'm ${voice.name}. This is how your notes will sound.`, AbortSignal.timeout(TIMEOUT_MS));
    } catch (e) {
      throw new ProviderFailed(e instanceof Error ? e.message : 'provider failed');
    }
    if (mp3.length === 0) throw new ProviderFailed('empty audio');
    await this.d.store.put(voice.id, mp3);
    return mp3;
  }
}
