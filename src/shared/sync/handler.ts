import { SYNCED_KEYS, type SyncOp } from '../sync-ops';
import { PUSH_MAX_MUTATIONS, type PullRequest, type PushRequest } from './protocol';
import type { SyncCore } from './server-core';

// The `sync` Edge Function's request handling, kept free of Deno so it is unit-tested in Node.
// The account always comes from the verified token; nothing in the body can choose it.

export type HandlerDeps = {
  /** The user id for a valid access token, else null. */
  verify(jwt: string): Promise<string | null>;
  core: Pick<SyncCore, 'push' | 'pull'>;
};

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ID = 200;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

class BadRequest extends Error {}

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const route = new URL(req.url).pathname.split('/').pop();
  if (req.method !== 'POST' || (route !== 'push' && route !== 'pull')) return json(404, { error: 'Not found' });

  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const userId = jwt ? await deps.verify(jwt).catch(() => null) : null;
  if (!userId) return json(401, { error: 'Sign in again' });

  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json(413, { error: 'Too large' });

  try {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new BadRequest('Not JSON');
    }
    if (route === 'push') return json(200, await deps.core.push(userId, readPush(body)));
    return json(200, await deps.core.pull(userId, readPull(body)));
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: err.message });
    console.error('[sync] failed', err); // the function's own log; the client only learns that it failed
    return json(500, { error: 'Server error' });
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = MAX_ID): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function need(ok: boolean, what: string): asserts ok {
  if (!ok) throw new BadRequest(`Invalid ${what}`);
}

function readPull(b: unknown): PullRequest {
  need(isObject(b) && str(b.clientId, 100) && count(b.cursor), 'pull');
  return { clientId: b.clientId as string, cursor: b.cursor as number };
}

function readPush(b: unknown): PushRequest {
  need(isObject(b) && str(b.clientId, 100) && str(b.deviceName, 100) && Array.isArray(b.mutations), 'push');
  const mutations = b.mutations as unknown[];
  need(mutations.length <= PUSH_MAX_MUTATIONS, 'push: too many changes');
  return {
    clientId: b.clientId as string,
    deviceName: b.deviceName as string,
    mutations: mutations.map((m) => {
      need(isObject(m) && str(m.id, 100) && count(m.baseVersion), 'change');
      return { id: m.id as string, op: readOp(m.op), baseVersion: m.baseVersion as number };
    }),
  };
}

const ROW_OPS = new Set([
  'note.create', 'note.update', 'note.delete',
  'page.create', 'page.update', 'page.setBody', 'page.append', 'page.setTask', 'page.delete',
  'folder.create', 'folder.update', 'folder.delete',
]);

function readOp(o: unknown): SyncOp {
  need(isObject(o) && typeof o.op === 'string', 'change');
  if (o.op === 'prefs.set') {
    need((SYNCED_KEYS as readonly unknown[]).includes(o.key) && 'value' in o, 'setting');
    return o as SyncOp;
  }
  need(ROW_OPS.has(o.op) && str(o.id), `change ${o.op}`);
  const at = o.at === undefined || count(o.at);
  switch (o.op) {
    case 'note.create':
    case 'page.create':
    case 'folder.create':
      need(isObject(o.row) && o.row.id === o.id, 'row');
      break;
    case 'note.update':
    case 'page.update':
    case 'folder.update':
      need(isObject(o.fields), 'fields');
      break;
    case 'page.setBody':
      need(typeof o.body === 'string' && at, 'body');
      break;
    case 'page.append':
      need(typeof o.text === 'string' && typeof o.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.day) && at, 'append');
      break;
    case 'page.setTask':
      need(count(o.line) && typeof o.lineText === 'string' && typeof o.checked === 'boolean' && at, 'task');
      break;
  }
  return o as SyncOp;
}
