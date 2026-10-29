import { net, protocol } from 'electron';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { IdSchema } from '../shared/ipc';
import { IMAGE_FILE_RE } from '../shared/page-images';
import type { NoteStore } from './store/note-store';

/** Brings audio and images from the account when they aren't on this PC (sync/files.ts). */
type Fetcher = { fetchAudio(id: string): Promise<void>; fetchImage(name: string): Promise<void> };

/** Must run before app 'ready'. */
export function registerNoteScheme(): void {
  const privileges = { standard: true, secure: true, stream: true, supportFetchAPI: true };
  protocol.registerSchemesAsPrivileged([
    { scheme: 'note', privileges },
    { scheme: 'vn-image', privileges },
  ]);
}

/** note://<id> streams that note's audio file, so renderers never see filesystem paths. */
export function registerNoteProtocol(store: NoteStore, files: Fetcher): void {
  protocol.handle('note', async (req) => {
    const id = IdSchema.safeParse(new URL(req.url).hostname);
    let note = id.success ? store.get(id.data) : undefined;
    // A note recorded on another PC: download its audio first (the dashboard shows why if this fails).
    if (note?.status === 'remote') {
      await files.fetchAudio(note.id).catch(() => undefined);
      note = store.get(note.id);
    }
    if (!note || note.status !== 'ok') return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(store.absolutePath(note)).toString(), { headers: req.headers });
  });
}

/** vn-image://<uuid>.<ext> serves a page image from <userData>/images; any other name is a 404. */
export function registerImageProtocol(store: NoteStore, files: Fetcher): void {
  protocol.handle('vn-image', async (req) => {
    const file = new URL(req.url).hostname;
    if (!IMAGE_FILE_RE.test(file)) return new Response('Not found', { status: 404 });
    // An image pasted on another PC: fetch it from the account (a failure is a 404; the next view retries).
    if (!fs.existsSync(store.pages.imagePath(file))) {
      try {
        await files.fetchImage(file);
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }
    return net.fetch(pathToFileURL(store.pages.imagePath(file)).toString());
  });
}
