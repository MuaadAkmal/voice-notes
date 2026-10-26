import { expect, it } from 'vitest';
import { handle } from '../../../src/shared/sync/handler';
import { MemoryStore } from '../../../src/shared/sync/memory-store';
import { SyncCore } from '../../../src/shared/sync/server-core';

const USER = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://x.supabase.co/functions/v1/sync';

function setup(over: { verify?: (jwt: string) => Promise<string | null>; core?: SyncCore } = {}) {
  const store = new MemoryStore();
  const core = over.core ?? new SyncCore(store);
  const deps = { verify: over.verify ?? (async (jwt: string) => (jwt === 'good' ? USER : null)), core };
  const call = (route: string, body: unknown, token: string | null = 'good', raw?: string) =>
    handle(
      new Request(`${BASE}/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: raw ?? JSON.stringify(body),
      }),
      deps,
    );
  return { store, call };
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

it('a server error hides its details', async () => {
  const core = { push: async () => Promise.reject(new Error('SQL secret')), pull: async () => Promise.reject(new Error('SQL secret')) };
  const res = await setup({ core: core as unknown as SyncCore }).call('push', push([]));
  expect(res.status).toBe(500);
  expect(await res.text()).toBe('{"error":"Server error"}');
});
