import { describe, expect, it } from 'vitest';
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

describe('storage', () => {
  const request = (token: string | null) =>
    new Request(`${BASE}/storage`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: '{}' });
  const base = { verify: async (jwt: string) => (jwt === 'good' ? USER : null), core: new SyncCore(new MemoryStore()) };

  it("answers the signed-in account's bytes against its plan", async () => {
    const asked: string[] = [];
    const storage = async (userId: string) => (asked.push(userId), { used: 180, limit: 250 });
    const res = await handle(request('good'), { ...base, storage });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ used: 180, limit: 250 });
    expect(asked).toEqual([USER]);
  });

  it('needs a token, and is 404 without the storage dep', async () => {
    expect((await handle(request(null), { ...base, storage: async () => ({ used: 0, limit: 1 }) })).status).toBe(401);
    expect((await handle(request('good'), base)).status).toBe(404);
  });
});

describe('sweep (the scheduled job)', () => {
  const request = (key: string | null) =>
    new Request(`${BASE}/sweep`, { method: 'POST', headers: key ? { 'x-sweep-key': key } : {}, body: '{}' });
  const base = { verify: async () => null, core: new SyncCore(new MemoryStore()) };

  it("runs on the job's key, with no account token", async () => {
    const keys: string[] = [];
    const sweep = async (key: string) => (keys.push(key), key === 'k');
    expect((await handle(request('k'), { ...base, sweep })).status).toBe(200);
    expect((await handle(request('wrong'), { ...base, sweep })).status).toBe(401);
    expect((await handle(request(null), { ...base, sweep })).status).toBe(401);
    expect(keys).toEqual(['k', 'wrong']);
  });

  it('is 404 without the sweep dep, and a failure says nothing more', async () => {
    expect((await handle(request('k'), base)).status).toBe(404);
    const res = await handle(request('k'), { ...base, sweep: async () => Promise.reject(new Error('storage down')) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Server error' });
  });
});

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
const noteRow = { id: NOTE, title: 'n', durationMs: 1, sizeBytes: 3, mimeType: 'audio/webm', createdAt: 1, updatedAt: 1, folderId: null, source: 'mic', kind: 'note', windowTitle: null, show: null, starred: false, transcript: null, transcriptLang: null, transcribedAt: null, polishedAt: null };

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
describe('CORS for the web app', () => {
  const APP = 'https://app.voicenote.cloud';
  const deps = () => ({
    verify: async (jwt: string) => (jwt === 'good' ? USER : null),
    core: new SyncCore(new MemoryStore()),
    origins: [APP],
  });
  const req = (method: string, origin: string | null, token: string | null = 'good') =>
    new Request(`${BASE}/pull`, {
      method,
      headers: {
        ...(origin ? { origin } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
      },
      ...(method === 'POST' ? { body: JSON.stringify({ clientId: 'W', cursor: 0 }) } : {}),
    });

  it('a preflight from the web app is 204 with CORS headers', async () => {
    const res = await handle(req('OPTIONS', APP, null), deps());
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
    expect(res.headers.get('access-control-allow-headers')).toContain('apikey');
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('a preflight from another origin is 404 without CORS headers', async () => {
    const res = await handle(req('OPTIONS', 'https://evil.example', null), deps());
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('responses to the web app carry the origin, errors too', async () => {
    const ok = await handle(req('POST', APP), deps());
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(APP);
    const denied = await handle(req('POST', APP, null), deps());
    expect(denied.status).toBe(401);
    expect(denied.headers.get('access-control-allow-origin')).toBe(APP);
  });

  it('a request without an Origin has no CORS headers', async () => {
    const res = await handle(req('POST', null), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

const POLISHED = `${NOTE}.polished.mp3`;

it('a note.update with polishedAt is accepted and pulled back with it; ttsVoice is a synced setting', async () => {
  const { call } = setup();
  await call('push', push([{ id: 'm1', op: { op: 'note.create', id: NOTE, row: noteRow }, baseVersion: 0 }]));
  const res = await call('push', push([
    { id: 'm2', op: { op: 'note.update', id: NOTE, fields: { polishedAt: 123 } }, baseVersion: 0 },
    { id: 'm3', op: { op: 'prefs.set', key: 'ttsVoice', value: 'voice-1' }, baseVersion: 0 },
  ]));
  expect(res.status).toBe(200);
  const pulled = await (await call('pull', { clientId: 'B', cursor: 0 })).json();
  expect(pulled.rows).toMatchObject([{ entity: 'note', id: NOTE, data: { polishedAt: 123 } }]);
  expect(pulled.prefs).toMatchObject([{ key: 'ttsVoice', value: 'voice-1' }]);
});

it('a polished name downloads, but never uploads', async () => {
  const { call, bucket } = setup();
  await call('push', push([{ id: 'm1', op: { op: 'note.create', id: NOTE, row: noteRow }, baseVersion: 0 }]));
  bucket.put('audio', `${USER}/${POLISHED}`, new Uint8Array([1]));
  const down = await call('files/download', { kind: 'audio', name: POLISHED });
  expect(await down.json()).toEqual({ status: 'ok', url: `http://files/blob/audio/${USER}/${POLISHED}` });
  expect((await call('files/upload', { kind: 'audio', name: POLISHED, size: 3 })).status).toBe(400);
});

it('clearing polishedAt removes the polished object; a note delete removes it with the original', async () => {
  const { call, bucket } = setup();
  await call('push', push([{ id: 'm1', op: { op: 'note.create', id: NOTE, row: { ...noteRow, polishedAt: 5 } }, baseVersion: 0 }]));
  bucket.put('audio', `${USER}/${POLISHED}`, new Uint8Array([1]));
  bucket.put('audio', `${USER}/${NOTE}.webm`, new Uint8Array([1]));
  await call('push', push([{ id: 'm2', op: { op: 'note.update', id: NOTE, fields: { polishedAt: null } }, baseVersion: 0 }]));
  expect(bucket.get('audio', `${USER}/${POLISHED}`)).toBeUndefined();
  expect(bucket.get('audio', `${USER}/${NOTE}.webm`)).toBeDefined();
  bucket.put('audio', `${USER}/${POLISHED}`, new Uint8Array([1]));
  await call('push', push([{ id: 'm3', op: { op: 'note.delete', id: NOTE }, baseVersion: 0 }]));
  expect(bucket.get('audio', `${USER}/${POLISHED}`)).toBeUndefined();
  expect(bucket.get('audio', `${USER}/${NOTE}.webm`)).toBeUndefined();
});

it('a name that only looks like a polished file is refused', async () => {
  const { call } = setup();
  expect((await call('files/download', { kind: 'audio', name: `${NOTE}xpolishedxmp3` })).status).toBe(400);
});
