import fs from 'node:fs';
import type { Note, StatusMap, TestResult } from '../../shared/channels';
import { cleanTranscript, type TranscribeLanguage } from '../../shared/transcription';
import { silentWav, trimWav } from '../../shared/wav';
import type { NoteStore } from '../store/note-store';
import type { Endpoint } from './endpoint';
import { transcribe as realTranscribe } from './openai-client';
import { TranscriptionQueue } from './queue';
import type { Secrets } from './secrets';

export type ServiceDeps = {
  store: Pick<NoteStore, 'get' | 'absolutePath' | 'setTranscript'>;
  /** Where a job's request goes, read when the job starts. */
  endpoint: () => Promise<Endpoint>;
  secrets: Pick<Secrets, 'get'>; // for testing a server the user hasn't saved yet
  /** The dashboard decodes the clip and returns 16 kHz mono WAV (main has no audio decoder). */
  toWav: (bytes: Uint8Array, mimeType: string) => Promise<Uint8Array>;
  readFile?: (absPath: string) => Promise<Uint8Array>;
  /** Brings a remote note's audio (recorded on another PC) to this PC first. */
  fetchAudio?: (id: string) => Promise<void>;
  transcribe?: typeof realTranscribe;
  now?: () => number;
  notesChanged: () => void;
  onStatus: (s: StatusMap) => void;
};

const MISSING = 'Audio file is missing';
const LOCAL_MIN_TIMEOUT_MS = 10 * 60_000;

/** Voice note → WAV → the user's server → transcript on the note, one note at a time. */
export class TranscriptionService {
  private readonly queue: TranscriptionQueue;
  private readonly readFile: (absPath: string) => Promise<Uint8Array>;
  private readonly transcribe: typeof realTranscribe;
  private readonly now: () => number;

  constructor(private readonly d: ServiceDeps) {
    this.readFile = d.readFile ?? ((p) => fs.promises.readFile(p));
    this.transcribe = d.transcribe ?? realTranscribe;
    this.now = d.now ?? Date.now;
    this.queue = new TranscriptionQueue(
      (id, language) => this.run(id, language),
      d.onStatus,
    );
  }

  enqueue(ids: string[], language: TranscribeLanguage): void {
    this.queue.enqueue(ids, language === 'auto' ? null : language);
  }

  status(): StatusMap {
    return this.queue.status();
  }

  idle(): Promise<void> {
    return this.queue.idle();
  }

  /** Only the first `seconds` of a note, outside the queue: nothing is stored. Throws when it can't. */
  async peek(id: string, seconds: number): Promise<string> {
    const note = this.d.store.get(id);
    if (!note || note.status !== 'ok') throw new Error(MISSING);
    const audio = trimWav(await this.d.toWav(await this.readAudio(note), note.mimeType), seconds);
    const ep = await this.d.endpoint();
    try {
      const { text } = await this.transcribe({ baseUrl: ep.baseUrl, model: ep.model, apiKey: ep.apiKey, language: null, audio, filename: `${id}.wav` });
      return text;
    } finally {
      ep.release();
    }
  }

  /** One second of silence through the same client: checks URL, key and model together. */
  test(baseUrl: string, model: string): Promise<TestResult> {
    return this.probe(async () => ({ baseUrl, model, apiKey: this.d.secrets.get('server'), local: false, release: () => undefined }));
  }

  /** The same check against the provider in use (for the built-in engine, includes loading the model). */
  testCurrent(): Promise<TestResult> {
    return this.probe(this.d.endpoint);
  }

  private async probe(endpoint: () => Promise<Endpoint>): Promise<TestResult> {
    const started = this.now();
    try {
      const ep = await endpoint();
      try {
        const { language } = await this.transcribe({
          baseUrl: ep.baseUrl,
          model: ep.model,
          apiKey: ep.apiKey,
          language: null,
          audio: silentWav(1),
          filename: 'test.wav',
        });
        return { ok: true, ms: this.now() - started, language };
      } finally {
        ep.release();
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async run(id: string, language: string | null): Promise<void> {
    let note = this.d.store.get(id);
    if (!note) return; // deleted while queued
    if (note.status === 'remote' && this.d.fetchAudio) {
      await this.d.fetchAudio(id);
      note = this.d.store.get(id);
      if (!note) return;
    }
    if (note.status !== 'ok') throw new Error(MISSING);
    const audio = await this.d.toWav(await this.readAudio(note), note.mimeType);
    // Resolved when the job starts, so a fix made on the setup page applies to queued notes too.
    const ep = await this.d.endpoint();
    let result: Awaited<ReturnType<typeof realTranscribe>>;
    try {
      result = await this.transcribe({
        baseUrl: ep.baseUrl,
        model: ep.model,
        apiKey: ep.apiKey,
        language,
        audio,
        filename: `${id}.wav`,
        // On a CPU a long note can take a while: give it time in proportion to its length.
        ...(ep.local ? { timeoutMs: Math.max(LOCAL_MIN_TIMEOUT_MS, 4 * note.durationMs) } : {}),
      });
    } finally {
      ep.release();
    }
    try {
      this.d.store.setTranscript(id, cleanTranscript(result.text), result.language);
    } catch (e) {
      if (e instanceof Error && e.message === 'Note not found') return; // deleted mid-request
      throw e;
    }
    this.d.notesChanged();
  }

  private async readAudio(note: Note): Promise<Uint8Array> {
    try {
      return await this.readFile(this.d.store.absolutePath(note));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error(MISSING);
      throw e;
    }
  }
}
