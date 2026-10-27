import fs from 'node:fs';
import { imageRefs } from '../../shared/page-images';
import type { FileKind } from '../../shared/sync/protocol';
import type { NoteStore } from '../store/note-store';
import type { FileEntry } from './file-outbox';
import type { FetchAudioResult } from '../../shared/channels';
import { type HttpSyncServer, Offline, ServerError } from './http-server';

// Moving audio and page images between this PC and the account. Uploads drain the file queue after
// each sync (rows first, so the server knows what a file belongs to); downloads happen on first play
// or view. Bytes go to and from Storage through short-lived signed URLs from the `sync` function.

/** The account doesn't have this file (yet): the PC that made it hasn't uploaded it. */
export class NotUploaded extends Error {
  constructor() {
    super("This audio hasn't reached your account yet");
  }
}
/** Sync is off on this PC (or signed out, or another account): nothing to download from. */
export class SyncOff extends Error {
  constructor() {
    super('Turn on sync to get this audio');
  }
}

/** A failed download, as the dashboard's toast needs it. */
export function fetchFailure(err: unknown): Extract<FetchAudioResult, { ok: false }>['reason'] {
  if (err instanceof NotUploaded) return 'not-uploaded';
  if (err instanceof SyncOff) return 'sync-off';
  if (err instanceof Offline) return 'offline';
  return 'error';
}

type Server = Pick<HttpSyncServer, 'uploadUrl' | 'downloadUrl' | 'put' | 'get'>;

type Deps = {
  store: NoteStore;
  server: Server;
  /** Signed in as the account this PC syncs with, and sync turned on. */
  canSync(): boolean;
  now?: () => number;
  onNotesChanged(): void;
};

const STORAGE_FULL_RETRY_MS = 3_600_000;
/** A pasted image waits this long for the page body that references it to be saved and synced. */
const IMAGE_GRACE_MS = 10 * 60_000;
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export class FileSync {
  private readonly downloads = new Map<string, Promise<void>>();
  private readonly now: () => number;

  constructor(private readonly d: Deps) {
    this.now = d.now ?? Date.now;
  }

  waiting(): number {
    return this.d.store.sync.files.count();
  }

  /** Uploads what is due, one file at a time. Network failures throw (the controller backs off). */
  async drain(): Promise<{ storageFull: boolean }> {
    const { files } = this.d.store.sync;
    let storageFull = false;
    for (const entry of files.due()) {
      const local = this.localFile(entry);
      if (local === 'drop') {
        files.remove(entry.kind, entry.name);
        continue;
      }
      if (local === 'wait') continue;
      const bytes = await fs.promises.readFile(local).catch(() => null);
      if (!bytes) {
        files.remove(entry.kind, entry.name);
        continue;
      }
      const answer = await this.d.server.uploadUrl({ kind: entry.kind, name: entry.name, size: bytes.length });
      if (answer.status === 'not-yet') continue; // its row reaches the server with a later push
      if (answer.status !== 'ok') {
        if (answer.status === 'too-large') console.warn('[sync] too large to upload', entry.kind, entry.name);
        files.remove(entry.kind, entry.name);
        continue;
      }
      if ((await this.d.server.put(answer.url, bytes, contentType(entry))) === 'storage-full') {
        storageFull = true;
        files.later(entry.kind, entry.name, this.now() + STORAGE_FULL_RETRY_MS);
        continue;
      }
      files.remove(entry.kind, entry.name);
    }
    return { storageFull };
  }

  /** Brings a remote note's audio to this PC. Calls for the same note share one download. */
  fetchAudio(noteId: string): Promise<void> {
    return this.once(`audio:${noteId}`, async () => {
      const { store } = this.d;
      const note = store.get(noteId);
      if (!note) throw new Error('Note not found');
      if (note.status === 'ok') return;
      const bytes = await this.download('audio', `${noteId}.webm`);
      if (bytes.length !== note.sizeBytes) throw new ServerError(); // cut short: never keep half a recording
      await writeAtomic(store.absolutePath(note), bytes);
      store.syncAccess().sqlite.prepare("UPDATE notes SET status = 'ok' WHERE id = ? AND status <> 'ok'").run(noteId);
      this.d.onNotesChanged();
    });
  }

  /** Brings a page image to this PC. */
  fetchImage(name: string): Promise<void> {
    return this.once(`image:${name}`, async () => {
      const file = this.d.store.pages.imagePath(name);
      if (fs.existsSync(file)) return;
      await writeAtomic(file, await this.download('image', name));
    });
  }

  private async download(kind: FileKind, name: string): Promise<Uint8Array> {
    if (!this.d.canSync()) throw new SyncOff();
    const answer = await this.d.server.downloadUrl({ kind, name });
    if (answer.status !== 'ok') throw new NotUploaded();
    return this.d.server.get(answer.url);
  }

  private once(key: string, run: () => Promise<void>): Promise<void> {
    const running = this.downloads.get(key);
    if (running) return running;
    const p = run().finally(() => this.downloads.delete(key));
    this.downloads.set(key, p);
    return p;
  }

  /** The path to upload, or what to do with an entry whose file is no longer needed or not ready. */
  private localFile(entry: FileEntry): string | 'drop' | 'wait' {
    const { store } = this.d;
    if (entry.kind === 'audio') {
      const note = store.get(entry.name.replace(/\.webm$/, ''));
      if (!note || note.status !== 'ok') return 'drop';
      return store.absolutePath(note);
    }
    const file = store.pages.imagePath(entry.name);
    if (!fs.existsSync(file)) return 'drop';
    const referenced = store.pages.list().some((p) => imageRefs(p.body).has(entry.name));
    if (!referenced) return this.now() - entry.createdAt > IMAGE_GRACE_MS ? 'drop' : 'wait';
    return file;
  }
}

function contentType(entry: FileEntry): string {
  if (entry.kind === 'audio') return 'audio/webm';
  return IMAGE_TYPES[entry.name.split('.').pop() ?? ''] ?? 'application/octet-stream';
}

/** `.part` then rename, so a cut-off download never looks like a file. */
async function writeAtomic(file: string, bytes: Uint8Array): Promise<void> {
  const part = `${file}.part`;
  try {
    await fs.promises.writeFile(part, bytes);
    await fs.promises.rename(part, file);
  } catch (err) {
    await fs.promises.rm(part, { force: true });
    throw err;
  }
}
