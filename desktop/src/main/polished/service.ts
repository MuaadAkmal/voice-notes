import { CLONE_MIN_SECONDS, MAX_SPEAK_CHARS, STOCK_VOICES, type SpeakRequest, type SpeakResponse, type VoiceState } from '../../shared/asr/protocol';
import type { CloneResult, MakeResult, Note } from '../../shared/channels';
import { NotSignedIn, Offline } from '../sync/http-server';
import {
  CloneUnavailable,
  CloneUnavailableNow,
  type CloudUsage,
  NeedsPaidPlan,
  QuotaExceeded,
  StorageFull,
} from '../transcription/cloud-client';
import { joinWavs, pickSamples } from './samples';

// Polished audio: a note's transcript, cleaned up and read aloud by the `asr` function, kept as
// <id>.polished.mp3 beside the recording. Made only when the user asks (it costs Cloud minutes).

type Deps = {
  store: {
    get(id: string): Note | undefined;
    list(): Note[];
    setPolished(id: string, at: number | null): unknown;
  };
  files: { fetchPolished(noteId: string): Promise<void> };
  client: {
    speak(req: SpeakRequest): Promise<SpeakResponse>;
    voice(): Promise<VoiceState>;
    clone(wav: Uint8Array, consent: boolean): Promise<VoiceState>;
    removeClone(): Promise<VoiceState>;
  };
  /** The commands function's polish route; null means keep the text. Gives up after 30 s. */
  polish(text: string): Promise<string | null>;
  settings(): { ttsVoice: string };
  now(): number;
  onUsage(u: CloudUsage): void;
  notesChanged(): void;
  /** A note's recording as 16 kHz mono WAV (the same conversion transcription uses). */
  toWav(note: Note): Promise<Uint8Array>;
  /** A preview URL as a data: URL (main fetches it, so the window needs no web access); null when it can not be had. */
  fetchSample(url: string): Promise<string | null>;
  log?(...a: unknown[]): void;
};

const VOICE_TTL_MS = 5 * 60_000;

/** Cuts at the last whitespace within the limit; a text with none is cut hard. */
function cutAtWord(text: string): string {
  if (text.length <= MAX_SPEAK_CHARS) return text;
  const head = text.slice(0, MAX_SPEAK_CHARS + 1);
  const space = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'), head.lastIndexOf('\t'));
  return (space > 0 ? head.slice(0, space) : text.slice(0, MAX_SPEAK_CHARS)).trimEnd();
}

export class PolishedAudio {
  private readonly running = new Map<string, Promise<MakeResult>>();
  private voiceCache: { at: number; state: VoiceState } | null = null;

  constructor(private readonly d: Deps) {}

  /** One run per note at a time: a second call gets the first's promise. */
  make(noteId: string): Promise<MakeResult> {
    const busy = this.running.get(noteId);
    if (busy) return busy;
    const p = this.run(noteId).finally(() => this.running.delete(noteId));
    this.running.set(noteId, p);
    return p;
  }

  remove(noteId: string): void {
    this.d.store.setPolished(noteId, null);
    this.d.notesChanged();
  }

  /** The account changed: its voice is somebody else's now. */
  accountChanged(): void {
    this.voiceCache = null;
  }

  /** The voices the account can use; `{ signedOut }` when nobody is signed in. */
  async voiceState(): Promise<VoiceState | { signedOut: true }> {
    try {
      return await this.state();
    } catch (e) {
      if (e instanceof NotSignedIn) return { signedOut: true };
      throw e;
    }
  }

  /** `consent`: the user ticked that the voice is their own; the server refuses without it. */
  async clone(consent: true): Promise<CloneResult> {
    const wavs: Uint8Array[] = [];
    for (const note of pickSamples(this.d.store.list())) {
      try {
        wavs.push(await this.d.toWav(note));
      } catch (e) {
        this.d.log?.('[polished] a sample could not be read', note.id, e); // the rest may still be enough
      }
    }
    const wav = joinWavs(wavs);
    if ((wav.length - 44) / 32000 < CLONE_MIN_SECONDS) return { error: 'few-notes' };
    try {
      return await this.changed(this.d.client.clone(wav, consent));
    } catch (e) {
      return this.cloneError(e);
    }
  }

  /** A stock voice's preview as a data: URL, or null. */
  async sample(voiceId: string): Promise<string | null> {
    try {
      const url = (await this.state()).stock.find((v) => v.id === voiceId)?.previewUrl;
      return url ? await this.d.fetchSample(url) : null;
    } catch {
      return null;
    }
  }

  async removeVoice(): Promise<VoiceState> {
    return this.changed(this.d.client.removeClone());
  }

  private async changed(p: Promise<VoiceState>): Promise<VoiceState> {
    this.voiceCache = null;
    try {
      return await p;
    } finally {
      this.voiceCache = null; // read afresh next time
    }
  }

  private cloneError(e: unknown): CloneResult {
    if (e instanceof CloneUnavailable || e instanceof CloneUnavailableNow) return { error: 'unavailable' };
    if (e instanceof NeedsPaidPlan) return { error: 'needs-paid-plan' };
    this.d.log?.('[polished] clone failed', e);
    return { error: 'failed' };
  }

  private async state(): Promise<VoiceState> {
    const c = this.voiceCache;
    if (c && this.d.now() - c.at < VOICE_TTL_MS) return c.state;
    const state = await this.d.client.voice();
    this.voiceCache = { at: this.d.now(), state };
    return state;
  }

  /** The chosen voice, but 'clone' only while the copy is ready; else the first stock voice. */
  private async voice(): Promise<string> {
    const wanted = this.d.settings().ttsVoice;
    if (wanted !== 'clone') return wanted;
    try {
      if ((await this.state()).clone === 'ready') return 'clone';
    } catch {
      // can't tell: read it in a stock voice rather than fail
    }
    return STOCK_VOICES[0].id;
  }

  private async run(noteId: string): Promise<MakeResult> {
    const transcript = this.d.store.get(noteId)?.transcript?.trim();
    if (!transcript) return { ok: false, reason: 'no-transcript' };
    try {
      // Not stored whether Cloud already cleaned it up, so polish always (free); any failure reads the transcript.
      const polished = await this.d.polish(transcript).catch(() => null);
      const text = cutAtWord(polished?.trim() || transcript);
      const voice = await this.voice();
      let r: SpeakResponse;
      try {
        r = await this.d.client.speak({ noteId, text, voice });
      } catch (e) {
        if (!(e instanceof CloneUnavailable) || voice !== 'clone') throw e;
        // The cached state was stale (clone removed elsewhere, plan dropped): read it in the stock voice.
        this.voiceCache = null;
        r = await this.d.client.speak({ noteId, text, voice: STOCK_VOICES[0].id });
      }
      this.d.onUsage({ used: r.used, limit: r.limit, resetsAt: r.resetsAt });
    } catch (e) {
      return this.failure(e);
    }
    this.d.store.setPolished(noteId, this.d.now());
    // The file downloads on first play if this fails.
    await this.d.files.fetchPolished(noteId).catch((e) => this.d.log?.('[polished] download failed', noteId, e));
    this.d.notesChanged();
    return { ok: true };
  }

  private failure(e: unknown): MakeResult {
    if (e instanceof NotSignedIn) return { ok: false, reason: 'signed-out' };
    if (e instanceof Offline) return { ok: false, reason: 'offline' };
    if (e instanceof QuotaExceeded) return { ok: false, reason: 'quota', resetsAt: e.resetsAt };
    if (e instanceof StorageFull) return { ok: false, reason: 'storage-full' };
    this.d.log?.('[polished] make failed', e);
    return { ok: false, reason: 'failed' };
  }
}
