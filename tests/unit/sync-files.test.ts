import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { UploadResponse } from '../../src/shared/sync/protocol';
import { NoteStore } from '../../src/main/store/note-store';
import { FileSync, NotUploaded, SyncOff } from '../../src/main/sync/files';
import { Offline } from '../../src/main/sync/http-server';

const MIN = 60_000;
let root: string;
let clock: number;
let store: NoteStore;
let canSync: boolean;
let changed: number;
const audio = (s = 'abc') => ({ bytes: Buffer.from(s), durationMs: 1500, mimeType: 'audio/webm;codecs=opus', source: 'mic' as const });

/** The account's side: a bucket in memory and answers the tests can steer. */
function fakeServer() {
  const objects = new Map<string, Uint8Array>();
  const s = {
    objects,
    uploadAnswer: null as UploadResponse | null,
    putAnswer: 'ok' as 'ok' | 'storage-full',
    offline: false,
    truncate: false,
    gets: 0,
    uploads: [] as string[],
    async uploadUrl(req: { kind: string; name: string; size: number }): Promise<UploadResponse> {
      if (s.offline) throw new Offline();
      return s.uploadAnswer ?? { status: 'ok', url: `blob:${req.kind}/${req.name}` };
    },
    async downloadUrl(req: { kind: string; name: string }) {
      if (s.offline) throw new Offline();
      const key = `blob:${req.kind}/${req.name}`;
      return objects.has(key) ? { status: 'ok' as const, url: key } : { status: 'not-uploaded' as const };
    },
    async put(url: string, bytes: Uint8Array, contentType: string): Promise<'ok' | 'storage-full'> {
      if (s.putAnswer === 'ok') {
        objects.set(url, bytes);
        s.uploads.push(`${url} ${contentType}`);
      }
      return s.putAnswer;
    },
    async get(url: string): Promise<Uint8Array> {
      s.gets++;
      await new Promise((r) => setTimeout(r, 5));
      const bytes = objects.get(url)!;
      return s.truncate ? bytes.slice(0, 1) : bytes;
    },
  };
  return s;
}

let server: ReturnType<typeof fakeServer>;
let files: FileSync;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-filesync-'));
  clock = 1_000_000;
  canSync = true;
  changed = 0;
  store = NoteStore.open(root, () => clock, () => 'PC-A');
  store.sync.state.setEnabled(true);
  server = fakeServer();
  files = new FileSync({ store, server, canSync: () => canSync, now: () => clock, onNotesChanged: () => changed++ });
});
afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** A note that came from another PC: its row is here, its audio only in the account. */
async function remoteNote(content = 'xyz') {
  const note = await store.create(audio(content));
  store.sync.files.remove('audio', `${note.id}.webm`);
  server.objects.set(`blob:audio/${note.id}.webm`, new Uint8Array(Buffer.from(content)));
  fs.rmSync(store.absolutePath(note));
  store.syncAccess().sqlite.prepare("UPDATE notes SET status = 'remote' WHERE id = ?").run(note.id);
  return note;
}

it('drain uploads queued audio and empties the queue', async () => {
  const note = await store.create(audio('hello'));
  expect(files.waiting()).toBe(1);
  expect(await files.drain()).toEqual({ storageFull: false });
  expect(files.waiting()).toBe(0);
  expect(server.uploads).toEqual([`blob:audio/${note.id}.webm audio/webm`]);
  expect(Buffer.from(server.objects.get(`blob:audio/${note.id}.webm`)!).toString()).toBe('hello');
});

it('not-yet stays queued; gone and too-large are dropped', async () => {
  await store.create(audio());
  server.uploadAnswer = { status: 'not-yet' };
  await files.drain();
  expect(files.waiting()).toBe(1);
  server.uploadAnswer = { status: 'gone' };
  await files.drain();
  expect(files.waiting()).toBe(0);
  await store.create(audio());
  server.uploadAnswer = { status: 'too-large' };
  await files.drain();
  expect(files.waiting()).toBe(0);
});

it('storage full keeps the entry for an hour and reports storageFull', async () => {
  await store.create(audio());
  server.putAnswer = 'storage-full';
  expect(await files.drain()).toEqual({ storageFull: true });
  expect(files.waiting()).toBe(1);
  server.putAnswer = 'ok';
  clock += 59 * MIN;
  await files.drain();
  expect(server.uploads).toEqual([]); // not due yet
  clock += 2 * MIN;
  expect(await files.drain()).toEqual({ storageFull: false });
  expect(files.waiting()).toBe(0);
});

it('an offline drain throws and keeps the queue', async () => {
  await store.create(audio());
  server.offline = true;
  await expect(files.drain()).rejects.toBeInstanceOf(Offline);
  expect(files.waiting()).toBe(1);
});

it('an unreferenced image younger than 10 minutes stays queued; older is dropped', async () => {
  const url = await store.pages.saveImage(new Uint8Array([1, 2]), 'png');
  server.uploadAnswer = { status: 'not-yet' };
  await files.drain();
  expect(files.waiting()).toBe(1); // its page body may still be saving
  clock += 11 * MIN;
  await files.drain();
  expect(files.waiting()).toBe(0);
  // Referenced by a page: it uploads, with its image type.
  server.uploadAnswer = null;
  const img = (await store.pages.saveImage(new Uint8Array([3]), 'jpg')).slice('vn-image://'.length);
  const page = store.pages.create(null);
  store.pages.setBody(page.id, `![](vn-image://${img}) ![](${url})`);
  await files.drain();
  expect(server.uploads).toEqual([`blob:image/${img} image/jpeg`]);
});

it('a queued note that is gone or remote here is dropped without asking the server', async () => {
  const note = await store.create(audio());
  fs.rmSync(store.absolutePath(note));
  server.offline = true; // would throw if asked
  await files.drain();
  expect(files.waiting()).toBe(0);
});

it('fetchAudio downloads, makes the note ok and tells the dashboard', async () => {
  const note = await remoteNote('xyz');
  await files.fetchAudio(note.id);
  expect(store.get(note.id)!.status).toBe('ok');
  expect(fs.readFileSync(store.absolutePath(note), 'utf8')).toBe('xyz');
  expect(changed).toBe(1);
});

it('two fetchAudio calls share one download', async () => {
  const note = await remoteNote();
  await Promise.all([files.fetchAudio(note.id), files.fetchAudio(note.id)]);
  expect(server.gets).toBe(1);
  await files.fetchAudio(note.id); // already here
  expect(server.gets).toBe(1);
});

it('a short download is discarded and leaves no .part', async () => {
  const note = await remoteNote('xyz');
  server.truncate = true;
  await expect(files.fetchAudio(note.id)).rejects.toThrow();
  expect(store.get(note.id)!.status).toBe('remote');
  expect(fs.readdirSync(path.join(root, 'recordings'))).toEqual([]);
});

it('fetchAudio is NotUploaded when the account has no object, SyncOff when sync is off', async () => {
  const note = await remoteNote();
  server.objects.clear();
  await expect(files.fetchAudio(note.id)).rejects.toBeInstanceOf(NotUploaded);
  canSync = false;
  await expect(files.fetchAudio(note.id)).rejects.toBeInstanceOf(SyncOff);
});

it('fetchImage downloads a missing page image', async () => {
  const name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';
  server.objects.set(`blob:image/${name}`, new Uint8Array([9, 9]));
  await files.fetchImage(name);
  expect([...fs.readFileSync(store.pages.imagePath(name))]).toEqual([9, 9]);
});
