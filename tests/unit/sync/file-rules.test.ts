import { expect, it } from 'vitest';
import { MemoryBucket } from '../../../src/shared/sync/file-bucket';
import { FileRules } from '../../../src/shared/sync/file-rules';
import { MemoryStore } from '../../../src/shared/sync/memory-store';
import type { PushRequest } from '../../../src/shared/sync/protocol';
import { SyncCore } from '../../../src/shared/sync/server-core';
import type { NoteRow, PageRow, SyncOp } from '../../../src/shared/sync-ops';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IMG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png';
const HOUR = 3_600_000;

const note = (id: string): NoteRow => ({
  id, title: 'n', durationMs: 1, sizeBytes: 3, mimeType: 'audio/webm', createdAt: 1, updatedAt: 1, folderId: null,
  source: 'mic', kind: 'note', windowTitle: null, show: null, starred: false, transcript: null, transcriptLang: null, transcribedAt: null,
});
const page = (id: string, body: string): PageRow => ({ id, title: 'P', body, folderId: null, starred: false, createdAt: 1, updatedAt: 1 });

function setup() {
  let clock = Date.UTC(2026, 0, 1);
  const now = () => clock;
  const store = new MemoryStore();
  const core = new SyncCore(store);
  const bucket = new MemoryBucket('http://files', now);
  const rules = new FileRules(store, bucket, now);
  let seq = 0;
  const req = (ops: SyncOp[]): PushRequest => ({ clientId: 'A', deviceName: 'PC-A', mutations: ops.map((op) => ({ id: `m${++seq}`, op, baseVersion: 0 })) });
  const push = async (user: string, ...ops: SyncOp[]) => {
    const r = req(ops);
    await core.push(user, r);
    await rules.afterPush(user, r);
  };
  return { store, bucket, rules, push, tick: (ms: number) => (clock += ms) };
}

it("upload of a live note's audio returns a signed url under the user's folder", async () => {
  const { rules, push } = setup();
  await push(USER, { op: 'note.create', id: NOTE, row: note(NOTE) });
  const res = await rules.upload(USER, { kind: 'audio', name: `${NOTE}.webm`, size: 3 });
  expect(res.status).toBe('ok');
  expect(res.status === 'ok' && res.url).toMatch(new RegExp(`/blob/audio/${USER}/${NOTE}\\.webm$`));
});

it('upload before the note row exists is not-yet; after its delete is gone', async () => {
  const { rules, push } = setup();
  const ask = () => rules.upload(USER, { kind: 'audio', name: `${NOTE}.webm`, size: 3 });
  expect(await ask()).toEqual({ status: 'not-yet' });
  await push(USER, { op: 'note.create', id: NOTE, row: note(NOTE) });
  await push(USER, { op: 'note.delete', id: NOTE });
  expect(await ask()).toEqual({ status: 'gone' });
});

it('upload over the size limit is too-large', async () => {
  const { rules, push } = setup();
  await push(USER, { op: 'note.create', id: NOTE, row: note(NOTE) });
  expect(await rules.upload(USER, { kind: 'audio', name: `${NOTE}.webm`, size: 50 * 1024 * 1024 + 1 })).toEqual({ status: 'too-large' });
  expect(await rules.upload(USER, { kind: 'image', name: IMG, size: 20 * 1024 * 1024 + 1 })).toEqual({ status: 'too-large' });
});

it('image upload is ok only once a live page references it', async () => {
  const { rules, push } = setup();
  const ask = () => rules.upload(USER, { kind: 'image', name: IMG, size: 10 });
  await push(USER, { op: 'page.create', id: 'p', row: page('p', 'no pictures') });
  expect(await ask()).toEqual({ status: 'not-yet' });
  await push(USER, { op: 'page.setBody', id: 'p', body: `![](vn-image://${IMG})` });
  expect((await ask()).status).toBe('ok');
});

it("another account's note id is not-yet, never a URL", async () => {
  const { rules, push, bucket } = setup();
  await push(USER, { op: 'note.create', id: NOTE, row: note(NOTE) });
  bucket.put('audio', `${USER}/${NOTE}.webm`, new Uint8Array([1, 2, 3]));
  expect(await rules.upload(OTHER, { kind: 'audio', name: `${NOTE}.webm`, size: 3 })).toEqual({ status: 'not-yet' });
  expect(await rules.download(OTHER, { kind: 'audio', name: `${NOTE}.webm` })).toEqual({ status: 'not-uploaded' });
});

it("download of an object that isn't there is not-uploaded; after put it is ok", async () => {
  const { rules, bucket } = setup();
  expect(await rules.download(USER, { kind: 'audio', name: `${NOTE}.webm` })).toEqual({ status: 'not-uploaded' });
  bucket.put('audio', `${USER}/${NOTE}.webm`, new Uint8Array([1]));
  const res = await rules.download(USER, { kind: 'audio', name: `${NOTE}.webm` });
  expect(res.status === 'ok' && res.url).toMatch(new RegExp(`/blob/audio/${USER}/${NOTE}\\.webm$`));
});

it('a pushed note delete removes its audio', async () => {
  const { push, bucket } = setup();
  await push(USER, { op: 'note.create', id: NOTE, row: note(NOTE) });
  bucket.put('audio', `${USER}/${NOTE}.webm`, new Uint8Array([1]));
  await push(USER, { op: 'note.delete', id: NOTE });
  expect(bucket.get('audio', `${USER}/${NOTE}.webm`)).toBeUndefined();
});

it('cleanup removes audio of deleted notes and images unreferenced for over 24 h, at most hourly', async () => {
  const { push, bucket, tick } = setup();
  const KEPT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await push(USER, { op: 'note.create', id: KEPT, row: note(KEPT) }, { op: 'page.create', id: 'p', row: page('p', `vn-image://${IMG}`) });
  const orphanAudio = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd.webm';
  const orphanImg = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png';
  bucket.put('audio', `${USER}/${KEPT}.webm`, new Uint8Array([1]));
  bucket.put('audio', `${USER}/${orphanAudio}`, new Uint8Array([1]));
  bucket.put('image', `${USER}/${IMG}`, new Uint8Array([1]));
  bucket.put('image', `${USER}/${orphanImg}`, new Uint8Array([1]));
  bucket.put('audio', `${OTHER}/${orphanAudio}`, new Uint8Array([1])); // another account's: never touched

  tick(HOUR + 1);
  await push(USER);
  expect(bucket.get('audio', `${USER}/${orphanAudio}`)).toBeUndefined();
  expect(bucket.get('audio', `${USER}/${KEPT}.webm`)).toBeDefined();
  expect(bucket.get('image', `${USER}/${orphanImg}`)).toBeDefined(); // only an hour old

  tick(22.5 * HOUR); // 23.5 h old: swept, but too young to go
  await push(USER);
  expect(bucket.get('image', `${USER}/${orphanImg}`)).toBeDefined();
  tick(40 * 60_000); // 24 h 10 min old, but the last sweep was 40 min ago
  await push(USER);
  expect(bucket.get('image', `${USER}/${orphanImg}`)).toBeDefined();
  tick(30 * 60_000);
  await push(USER);
  expect(bucket.get('image', `${USER}/${orphanImg}`)).toBeUndefined();
  expect(bucket.get('image', `${USER}/${IMG}`)).toBeDefined();
  expect(bucket.get('audio', `${OTHER}/${orphanAudio}`)).toBeDefined();
});

it('cleanup never removes audio uploaded for a note pushed while it ran', async () => {
  const store = new MemoryStore();
  const core = new SyncCore(store);
  let clock = Date.UTC(2026, 0, 1);
  const bucket = new MemoryBucket('http://files', () => clock);
  // PC B pushes a note and uploads its audio right after this sweep read the live rows.
  const racing = {
    fileOwner: store.fileOwner.bind(store),
    liveFiles: async (user: string) => {
      const live = await store.liveFiles(user);
      await core.push(user, { clientId: 'B', deviceName: 'PC-B', mutations: [{ id: 'b1', op: { op: 'note.create', id: NOTE, row: note(NOTE) }, baseVersion: 0 }] });
      bucket.put('audio', `${USER}/${NOTE}.webm`, new Uint8Array([1]));
      return live;
    },
  };
  const rules = new FileRules(racing, bucket, () => clock);
  await rules.afterPush(USER, { clientId: 'A', deviceName: 'PC-A', mutations: [] });
  expect(bucket.get('audio', `${USER}/${NOTE}.webm`)).toBeDefined();
});
