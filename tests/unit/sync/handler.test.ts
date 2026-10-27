import { expect, it } from 'vitest';
import { MemoryBucket } from '../../../src/shared/sync/file-bucket';
import { FileRules } from '../../../src/shared/sync/file-rules';
import { handle } from '../../../src/shared/sync/handler';
import { MemoryStore } from '../../../src/shared/sync/memory-store';
import { SyncCore } from '../../../src/shared/sync/server-core';

const USER = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://x.supabase.co/functions/v1/sync';

function setup(
  over: { verify?: (jwt: string) => Promise<string | null>; core?: SyncCore; bucket?: MemoryBucket; notify?: (userId: string, from: string) => Promise<void> } = {},
) {
  const store = new MemoryStore();
  const core = over.core ?? new SyncCore(store);
  const bucket = over.bucket ?? new MemoryBucket('http://files');
  const files = new FileRules(store, bucket);
  const deps = { verify: over.verify ?? (async (jwt: string) => (jwt === 'good' ? USER : null)), core, files, notify: over.notify };
  const call = (route: string, body: unknown, token: string | null = 'good', raw?: string) =>
    handle(
      new Request(`${BASE}/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: raw ?? JSON.stringify(body),
      }),
      deps,
    );
  return { store, call, bucket };
}

const folder = { id: 'f', name: 'F', parentId: null, createdAt: 1, updatedAt: 1 };
const push = (mutations: unknown[]) => ({ clientId: 'A', deviceName: 'PC-A', mutations });

it('no token, or a token that does not verify, is 401', async () => {
  const { call } = setup();
  expect((await call('pull', { clientId: 'A', cursor: 0 }, null)).status).toBe(401);
  expect((await call('pull', { clientId: 'A', cursor: 0 }, 'bad')).status).toBe(401);
});

it('an unknown route is 404', async () => {
  expect((await setup().call('nope', {})).status).toBe(404);
});

it('a body over 1 MB is 413', async () => {
  const res = await setup().call('push', null, 'good', JSON.stringify(push([])) + ' '.repeat(1_100_000));
  expect(res.status).toBe(413);
});

it('more than 100 changes, an unknown change, or a bad shape is 400', async () => {
  const { call } = setup();
  const many = Array.from({ length: 101 }, (_, i) => ({ id: `m${i}`, op: { op: 'note.delete', id: 'n' }, baseVersion: 0 }));
  expect((await call('push', push(many))).status).toBe(400);
  expect((await call('push', push([{ id: 'm', op: { op: 'x.y', id: 'n' }, baseVersion: 0 }]))).status).toBe(400);
  expect((await call('push', { clientId: 'A', mutations: [] })).status).toBe(400); // no deviceName
  expect((await call('pull', { clientId: 'A', cursor: -1 })).status).toBe(400);
  expect((await call('push', null, 'good', '{not json')).status).toBe(400);
  const bad = await call('push', push([{ id: 'm', op: { op: 'folder.create', id: 'f' }, baseVersion: 0 }])); // no row
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ error: expect.any(String) });
});

it('a push lands in the account of the verified token, whatever the body says', async () => {
  const { store, call } = setup();
  const res = await call('push', { ...push([{ id: 'm1', op: { op: 'folder.create', id: 'f', row: folder }, baseVersion: 0 }]), userId: 'someone-else' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ acked: [{ id: 'm1', version: 1 }] });
  expect(store.rows(USER).map((r) => r.id)).toEqual(['f']);
  expect(store.rows('someone-else')).toEqual([]);
  const pulled = await (await call('pull', { clientId: 'B', cursor: 0 })).json();
  expect(pulled).toMatchObject({ cursor: 1, hasMore: false, rows: [{ entity: 'folder', id: 'f' }] });
});

it('a null character in text (which Postgres JSON cannot hold) is dropped, not a failure', async () => {
  const { store, call } = setup();
  const page = { id: 'p', title: 'T\u0000', body: 'pasted\u0000text', folderId: null, starred: false, createdAt: 1, updatedAt: 1 };
  const res = await call('push', push([{ id: 'm1', op: { op: 'page.create', id: 'p', row: page }, baseVersion: 0 }]));
  expect(res.status).toBe(200);
  expect(store.rows(USER)[0].data).toMatchObject({ title: 'T', body: 'pastedtext' });
});

it('numbers must be safe integers, rows need their fields, and updates only their own fields', async () => {
  const { call } = setup();
  expect((await call('pull', { clientId: 'A', cursor: 1e300 })).status).toBe(400);
  expect((await call('push', push([{ id: 'm', op: { op: 'note.delete', id: 'n' }, baseVersion: 1.5 }]))).status).toBe(400);
  const noName = { id: 'f', parentId: null, createdAt: 1, updatedAt: 1 };
  expect((await call('push', push([{ id: 'm', op: { op: 'folder.create', id: 'f', row: noName }, baseVersion: 0 }]))).status).toBe(400);
  // A body only changes through setBody/append/setTask (they carry the conflict rules); ids never change.
  expect((await call('push', push([{ id: 'm', op: { op: 'page.update', id: 'p', fields: { body: 'x' } }, baseVersion: 0 }]))).status).toBe(400);
  expect((await call('push', push([{ id: 'm', op: { op: 'note.update', id: 'n', fields: { id: 'other' } }, baseVersion: 0 }]))).status).toBe(400);
  expect((await call('push', push([{ id: 'm', op: { op: 'note.update', id: 'n', fields: { title: 'ok', starred: true } }, baseVersion: 0 }]))).status).toBe(200);
});

it('a database data error is a rejected change, not a server outage', async () => {
  const core = { push: async () => Promise.reject(Object.assign(new Error('unsupported Unicode escape sequence'), { code: '22P05' })), pull: async () => ({}) };
  const res = await setup({ core: core as unknown as SyncCore }).call('push', push([]));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'A change could not be stored' });
});

it('a server error hides its details', async () => {
  const core = { push: async () => Promise.reject(new Error('SQL secret')), pull: async () => Promise.reject(new Error('SQL secret')) };
  const res = await setup({ core: core as unknown as SyncCore }).call('push', push([]));
  expect(res.status).toBe(500);
  expect(await res.text()).toBe('{"error":"Server error"}');
});

const NOTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const noteRow = { id: NOTE, title: 'n', durationMs: 1, sizeBytes: 3, mimeType: 'audio/webm', createdAt: 1, updatedAt: 1, folderId: null, source: 'mic', kind: 'note', windowTitle: null, show: null, starred: false, transcript: null, transcriptLang: null, transcribedAt: null };

it('file routes need a token and a valid kind, name and size', async () => {
  const { call } = setup();
  expect((await call('files/upload', { kind: 'audio', name: `${NOTE}.webm`, size: 3 }, null)).status).toBe(401);
  expect((await call('files/upload', { kind: 'video', name: `${NOTE}.webm`, size: 3 })).status).toBe(400);
  expect((await call('files/upload', { kind: 'audio', name: '../x.webm', size: 3 })).status).toBe(400);
  expect((await call('files/upload', { kind: 'image', name: `${NOTE}.webm`, size: 3 })).status).toBe(400);
  expect((await call('files/upload', { kind: 'audio', name: `${NOTE}.webm`, size: -1 })).status).toBe(400);
  expect((await call('files/download', { kind: 'audio' })).status).toBe(400);
});

it('files/upload answers from the verified account', async () => {
  const { call } = setup();
  await call('push', push([{ id: 'm1', op: { op: 'note.create', id: NOTE, row: noteRow }, baseVersion: 0 }]));
  const res = await call('files/upload', { kind: 'audio', name: `${NOTE}.webm`, size: 3, userId: 'someone-else' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok', url: `http://files/blob/audio/${USER}/${NOTE}.webm` });
});

it('files/download of a missing object is not-uploaded', async () => {
  const res = await setup().call('files/download', { kind: 'audio', name: `${NOTE}.webm` });
  expect(await res.json()).toEqual({ status: 'not-uploaded' });
});

it('a pushed note delete removes its audio from the bucket', async () => {
  const { call, bucket } = setup();
  await call('push', push([{ id: 'm1', op: { op: 'note.create', id: NOTE, row: noteRow }, baseVersion: 0 }]));
  bucket.put('audio', `${USER}/${NOTE}.webm`, new Uint8Array([1, 2, 3]));
  await call('push', push([{ id: 'm2', op: { op: 'note.delete', id: NOTE }, baseVersion: 0 }]));
  expect(bucket.get('audio', `${USER}/${NOTE}.webm`)).toBeUndefined();
});

it('a bucket failure after a push still returns the acks', async () => {
  const bucket = new MemoryBucket('http://files');
  bucket.remove = async () => Promise.reject(new Error('storage down'));
  bucket.list = async () => Promise.reject(new Error('storage down'));
  const { call } = setup({ bucket });
  const res = await call('push', push([{ id: 'm1', op: { op: 'note.delete', id: NOTE }, baseVersion: 0 }]));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ acked: [{ id: 'm1', version: 0 }] });
});
it('a push with changes pings the account once, from the pushing PC', async () => {
  const pings: string[][] = [];
  const { call } = setup({ notify: async (u, from) => void pings.push([u, from]) });
  await call('push', push([{ id: 'm1', op: { op: 'folder.create', id: 'f', row: folder }, baseVersion: 0 }]));
  expect(pings).toEqual([[USER, 'A']]);
});

it('an empty push, a pull and file routes never ping', async () => {
  const pings: string[][] = [];
  const { call } = setup({ notify: async (u, from) => void pings.push([u, from]) });
  await call('push', push([]));
  await call('pull', { clientId: 'A', cursor: 0 });
  await call('files/download', { kind: 'audio', name: '11111111-1111-4111-8111-111111111111.webm' });
  expect(pings).toEqual([]);
});

it('a ping that fails still answers the push', async () => {
  const { call } = setup({ notify: async () => Promise.reject(new Error('realtime down')) });
  const res = await call('push', push([{ id: 'm1', op: { op: 'folder.create', id: 'f', row: folder }, baseVersion: 0 }]));
  expect(res.status).toBe(200);
  expect((await res.json()).acked).toHaveLength(1);
});