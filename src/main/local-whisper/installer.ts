import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { unzipSync } from 'fflate';
import { MODEL_IDS, type ModelId } from '../../shared/transcription';
import { type Asset, ENGINE_FILES, ENGINE_TAG, engineFor, type ModelInfo, MODELS } from './catalog';

export type InstallJob = { modelId: ModelId; phase: 'engine' | 'model'; received: number; total: number };
export type Catalog = { engine: Asset | null; models: ModelInfo[] };

export type InstallerDeps = {
  root: string; // %APPDATA%/Voice Notes/whisper
  arch: string;
  fetch: typeof fetch;
  onChange: () => void;
  catalog?: Catalog; // default: the pinned catalog for `arch`
  progressMs?: number;
  createWriteStream?: (file: string) => fs.WriteStream;
};

const FAILED = 'Download failed — check your connection';
const CORRUPTED = 'Download was corrupted — try again';
const NO_SPACE = 'Not enough disk space';
const CANCELLED = 'Cancelled';

/** Downloads, verifies and unpacks the engine and models. A file is installed only once it is complete and verified. */
export class Installer {
  private catalog: Catalog;
  private current: InstallJob | null = null;
  private abort: AbortController | null = null;
  private lastProgress = 0;
  private readonly progressMs: number;
  private readonly createWriteStream: (file: string) => fs.WriteStream;

  constructor(private readonly d: InstallerDeps) {
    this.catalog = d.catalog ?? { engine: engineFor(d.arch), models: MODELS };
    this.progressMs = d.progressMs ?? 250;
    this.createWriteStream = d.createWriteStream ?? ((f) => fs.createWriteStream(f));
  }

  /** Tests swap in a fake catalog after start-up. */
  setCatalog(c: Catalog): void {
    this.catalog = c;
  }

  private get engineDir(): string {
    return path.join(this.d.root, 'engine', ENGINE_TAG);
  }

  private get modelsDir(): string {
    return path.join(this.d.root, 'models');
  }

  private model(id: ModelId): ModelInfo | undefined {
    return this.catalog.models.find((m) => m.id === id);
  }

  available(): boolean {
    return this.catalog.engine !== null;
  }

  enginePath(): string | null {
    const exe = path.join(this.engineDir, 'whisper-server.exe');
    return fs.existsSync(exe) ? exe : null;
  }

  modelPath(id: ModelId): string | null {
    const m = this.model(id);
    if (!m) return null;
    const file = path.join(this.modelsDir, m.file);
    return fs.existsSync(file) ? file : null;
  }

  installed(): { engine: boolean; models: Record<ModelId, boolean> } {
    const models = Object.fromEntries(MODEL_IDS.map((id) => [id, this.modelPath(id) !== null])) as Record<ModelId, boolean>;
    return { engine: this.enginePath() !== null, models };
  }

  job(): InstallJob | null {
    return this.current ? { ...this.current } : null;
  }

  async install(id: ModelId): Promise<void> {
    if (this.current) throw new Error('A download is already running');
    const engine = this.catalog.engine;
    if (!engine) throw new Error('Not available on this PC');
    const model = this.model(id);
    if (!model) throw new Error(`Unknown model ${id}`);
    const abort = new AbortController();
    this.abort = abort;
    try {
      if (!this.enginePath()) {
        this.current = { modelId: id, phase: 'engine', received: 0, total: engine.bytes };
        this.d.onChange();
        const part = path.join(this.d.root, 'engine', `${engine.file}.part`);
        await this.download(engine, part, abort.signal);
        try {
          this.unpackEngine(part);
        } finally {
          fs.rmSync(part, { force: true });
        }
      }
      if (!this.modelPath(id)) {
        this.current = { modelId: id, phase: 'model', received: 0, total: model.bytes };
        this.d.onChange();
        const target = path.join(this.modelsDir, model.file);
        await this.download(model, `${target}.part`, abort.signal);
        fs.renameSync(`${target}.part`, target);
      }
    } finally {
      this.current = null;
      this.abort = null;
      this.d.onChange();
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  remove(id: ModelId, engineToo = false): void {
    const file = this.modelPath(id);
    // Retries: right after the engine exits, Windows (or a virus scanner) can hold its files a moment longer.
    if (file) fs.rmSync(file, { force: true, maxRetries: 10, retryDelay: 100 });
    if (engineToo) fs.rmSync(this.engineDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    this.d.onChange();
  }

  diskBytes(): number {
    const size = (p: string): number => {
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        return 0;
      }
      if (!st.isDirectory()) return st.size;
      return fs.readdirSync(p).reduce((sum, f) => sum + size(path.join(p, f)), 0);
    };
    return size(this.d.root);
  }

  /** Leftovers from a run that was interrupted (crash, power cut): never treated as installed. */
  cleanup(): void {
    for (const dir of [this.modelsDir, path.join(this.d.root, 'engine')]) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.part') || f.endsWith('.tmp')) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
      }
    }
  }

  /** One asset to `part`, trying each address in turn; the size and hash must match. */
  private async download(asset: Asset, part: string, signal: AbortSignal): Promise<void> {
    fs.mkdirSync(path.dirname(part), { recursive: true });
    for (const url of asset.urls) {
      if (signal.aborted) throw new Error(CANCELLED);
      let res: Response;
      try {
        res = await this.d.fetch(url, { signal });
      } catch {
        if (signal.aborted) throw new Error(CANCELLED);
        continue;
      }
      if (res.status !== 200 || !res.body) continue;
      const hash = crypto.createHash('sha256');
      let received = 0;
      const meter = new Transform({
        transform: (chunk: Buffer, _enc, done) => {
          hash.update(chunk);
          received += chunk.length;
          this.progress(received);
          done(null, chunk);
        },
      });
      try {
        await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), meter, this.createWriteStream(part), { signal });
      } catch (e) {
        fs.rmSync(part, { force: true });
        if (signal.aborted) throw new Error(CANCELLED);
        if ((e as NodeJS.ErrnoException).code === 'ENOSPC') throw new Error(NO_SPACE);
        continue; // dropped mid-way: try the next address
      }
      if (received !== asset.bytes || hash.digest('hex') !== asset.sha256) {
        fs.rmSync(part, { force: true });
        throw new Error(CORRUPTED);
      }
      return;
    }
    throw new Error(FAILED);
  }

  private progress(received: number): void {
    if (!this.current) return;
    this.current.received = received;
    const now = Date.now();
    if (now - this.lastProgress < this.progressMs) return;
    this.lastProgress = now;
    this.d.onChange();
  }

  /** Keeps only the server and its libraries, flattened out of the zip's folder, then moves them into place in one rename. */
  private unpackEngine(zipFile: string): void {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(fs.readFileSync(zipFile));
    } catch {
      throw new Error(CORRUPTED);
    }
    const tmp = `${this.engineDir}.tmp`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    try {
      for (const [name, data] of Object.entries(entries)) {
        if (name.split(/[\\/]/).includes('..') || path.isAbsolute(name) || /^[a-zA-Z]:/.test(name)) throw new Error(CORRUPTED);
        const base = path.posix.basename(name.replace(/\\/g, '/'));
        if (ENGINE_FILES(base)) fs.writeFileSync(path.join(tmp, base), data);
      }
      if (!fs.existsSync(path.join(tmp, 'whisper-server.exe'))) throw new Error(CORRUPTED);
      fs.rmSync(this.engineDir, { recursive: true, force: true });
      fs.renameSync(tmp, this.engineDir);
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
  }
}
