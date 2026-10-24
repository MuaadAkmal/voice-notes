import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { IdSchema } from '../shared/ipc';
import type { NoteStore } from './store/note-store';

/** Must run before app 'ready'. */
export function registerNoteScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'note', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ]);
}

/** note://<id> streams that note's audio file, so renderers never see filesystem paths. */
export function registerNoteProtocol(store: NoteStore): void {
  protocol.handle('note', (req) => {
    const id = IdSchema.safeParse(new URL(req.url).hostname);
    const note = id.success ? store.get(id.data) : undefined;
    if (!note || note.status !== 'ok') return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(store.absolutePath(note)).toString(), { headers: req.headers });
  });
}
