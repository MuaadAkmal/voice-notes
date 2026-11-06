import { ProviderFailed, QuotaExceeded, periodOf } from './core';
import { MAX_SPEAK_CHARS, STOCK_VOICES, type SpeakResponse } from './protocol';
import type { AsrStore } from './store';

// The rules of polished audio: read a note's text aloud, counted against the month's Cloud minutes.
// The estimate is reserved first and the unused part refunded once the file's real length is known,
// so a user is never charged past what was reserved.

export class BadSpeak extends Error {}
export class NotYourNote extends Error {}
export class StorageFull extends Error {}
export class CloneUnavailable extends Error {}

/** Seconds reserved for `chars` characters of text (generous; refunded down to the measured length). */
export const speakEstimate = (chars: number) => Math.ceil(chars / 12);
/** Length of a 128 kbps constant-bitrate MP3. */
export const mp3Seconds = (bytes: number) => Math.ceil(bytes / 16000);

export type Speaker = (voiceId: string, text: string, signal: AbortSignal) => Promise<Uint8Array>;

export type SpeakFiles = {
  owns(user: string, noteId: string): Promise<boolean>;
  /** Counts `bytes` against the account's storage; false when it doesn't fit. */
  reserve(user: string, path: string, bytes: number): Promise<boolean>;
  upload(path: string, mp3: Uint8Array): Promise<void>;
};

/** The account's usable clone's voice id (paid plan and a row), else null. */
export type CloneLookup = (user: string) => Promise<string | null>;

const NOTE_ID = /^[0-9a-f-]{36}$/; // the sync note id rule
const TIMEOUT_MS = 120_000;

export class SpeakCore {
  constructor(private readonly d: { store: AsrStore; speaker: Speaker; files: SpeakFiles; clone: CloneLookup; now: () => number }) {}

  async speak(user: string, req: unknown): Promise<SpeakResponse> {
    const r = (req && typeof req === 'object' ? req : {}) as Record<string, unknown>;
    const { noteId, voice } = r;
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (typeof noteId !== 'string' || !NOTE_ID.test(noteId)) throw new BadSpeak('bad note id');
    if (text.length < 1 || text.length > MAX_SPEAK_CHARS) throw new BadSpeak('text must be 1 to 5000 characters');
    if (typeof voice !== 'string' || (voice !== 'clone' && !STOCK_VOICES.some((v) => v.id === voice))) throw new BadSpeak('unknown voice');

    if (!(await this.d.files.owns(user, noteId))) throw new NotYourNote('not your note');
    let voiceId = voice;
    if (voice === 'clone') {
      const clone = await this.d.clone(user);
      if (!clone) throw new CloneUnavailable('no usable clone');
      voiceId = clone;
    }

    const estimate = speakEstimate(text.length);
    const { period, resetsAt } = periodOf(this.d.now()); // once: refunds go back to this same month
    const res = await this.d.store.reserve(user, period, estimate);
    if (!res.ok) throw new QuotaExceeded(resetsAt);
    let used = res.used;
    const refund = async (seconds: number) => {
      if (seconds <= 0) return;
      try {
        await this.d.store.refund(user, period, seconds);
        used -= seconds;
      } catch (e) {
        console.error('[asr] refund', e);
      }
    };

    let mp3: Uint8Array;
    try {
      mp3 = await this.d.speaker(voiceId, text, AbortSignal.timeout(TIMEOUT_MS));
    } catch (e) {
      await refund(estimate);
      throw new ProviderFailed(e instanceof Error ? e.message : 'provider failed');
    }
    if (mp3.length === 0) {
      await refund(estimate); // an empty 200 is no reading
      throw new ProviderFailed('empty audio');
    }
    const path = `${user}/${noteId}.polished.mp3`;
    let fits: boolean;
    try {
      fits = await this.d.files.reserve(user, path, mp3.length);
    } catch (e) {
      await refund(estimate);
      throw e;
    }
    if (!fits) {
      await refund(estimate);
      throw new StorageFull('storage full');
    }
    const seconds = Math.min(mp3Seconds(mp3.length), estimate);
    await refund(estimate - seconds);
    try {
      await this.d.files.upload(path, mp3);
    } catch (e) {
      await refund(seconds);
      throw e;
    }
    return { seconds, used, limit: res.limit, resetsAt };
  }
}
