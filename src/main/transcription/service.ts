import fs from 'node:fs';
import type {
  Note,
  Settings,
  StatusMap,
  TestResult,
} from '../../shared/channels';
import type { TranscribeLanguage } from '../../shared/transcription';
import { silentWav } from '../../shared/wav';
import type { NoteStore } from '../store/note-store';
import { transcribe as realTranscribe } from './openai-client';
import { TranscriptionQueue } from './queue';
import type { Secrets } from './secrets';

export type ServiceDeps = {
  store: Pick<NoteStore, 'get' | 'absolutePath' | 'setTranscript'>;
  getSettings: () => Settings;
  secrets: Pick<Secrets, 'get'>;
  /** The dashboard decodes the clip and returns 16 kHz mono WAV (main has no audio decoder). */
  toWav: (bytes: Uint8Array, mimeType: string) => Promise<Uint8Array>;
  readFile?: (absPath: string) => Promise<Uint8Array>;
  transcribe?: typeof realTranscribe;
  now?: () => number;
  notesChanged: () => void;
  onStatus: (s: StatusMap) => void;
};

const MISSING = 'Audio file is missing';

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

  /** One second of silence through the same client: checks URL, key and model together. */
  async test(baseUrl: string, model: string): Promise<TestResult> {
    const started = this.now();
    try {
      const { language } = await this.transcribe({
        baseUrl,
        model,
        apiKey: this.d.secrets.get('server'),
        language: null,
        audio: silentWav(1),
        filename: 'test.wav',
      });
      return { ok: true, ms: this.now() - started, language };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async run(id: string, language: string | null): Promise<void> {
    const note = this.d.store.get(id);
    if (!note) return; // deleted while queued
    if (note.status !== 'ok') throw new Error(MISSING);
    // Read when the job starts, so a fix made on the setup page applies to queued notes too.
    const { transcription } = this.d.getSettings();
    if (transcription.provider === null)
      throw new Error('Set up transcription first');
    const audio = await this.d.toWav(await this.readAudio(note), note.mimeType);
    const result = await this.transcribe({
      baseUrl: transcription.baseUrl,
      model: transcription.model,
      apiKey: this.d.secrets.get('server'),
      language,
      audio,
      filename: `${id}.wav`,
    });
    try {
      this.d.store.setTranscript(id, result.text.trim(), result.language);
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
