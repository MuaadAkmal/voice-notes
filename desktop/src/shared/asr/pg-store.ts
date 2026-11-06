import type { AsrStore } from './store';
import type { SpeakFiles } from './speak';
import type { CloneStore } from './voice';

// public.reserve_asr_seconds / refund_asr_seconds / asr_usage_for (migration *_asr_usage.sql). Two ways
// to call them: a Postgres client (tests), or PostgREST over HTTP with the service role key (the function).

/** The slice of a Postgres client the store needs (PGlite in tests). */
export type AsrDb = { query<T>(text: string, params?: unknown[]): Promise<T[]> };

type ReserveRow = { ok: boolean; used: number; lim: number };
type UsageRow = { used: number; lim: number; plan: string };

export class PgAsrStore implements AsrStore {
  constructor(private readonly db: AsrDb) {}

  async reserve(user: string, period: string, seconds: number) {
    const [r] = await this.db.query<ReserveRow>('select * from public.reserve_asr_seconds($1, $2, $3)', [user, period, seconds]);
    return { ok: r.ok, used: r.used, limit: r.lim };
  }

  async refund(user: string, period: string, seconds: number) {
    await this.db.query('select public.refund_asr_seconds($1, $2, $3)', [user, period, seconds]);
  }

  async usage(user: string, period: string) {
    const [r] = await this.db.query<UsageRow>('select * from public.asr_usage_for($1, $2)', [user, period]);
    return { used: r.used, limit: r.lim, plan: r.plan };
  }
}

/** The same functions through the project's REST API, with the service role key (server side only). */
export class RestAsrStore implements AsrStore {
  constructor(private readonly o: { url: string; serviceKey: string; fetch: typeof fetch }) {}

  private async rpc(fn: string, body: object): Promise<unknown> {
    const res = await this.o.fetch(`${this.o.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: this.o.serviceKey, authorization: `Bearer ${this.o.serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`${fn} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  private static row(fn: string, v: unknown): Record<string, unknown> {
    const r = Array.isArray(v) ? v[0] : v;
    if (!r || typeof r !== 'object') throw new Error(`${fn} sent no row`);
    return r as Record<string, unknown>;
  }

  async reserve(user: string, period: string, seconds: number) {
    const fn = 'reserve_asr_seconds';
    const r = RestAsrStore.row(fn, await this.rpc(fn, { p_user: user, p_period: period, p_seconds: seconds }));
    if (typeof r.ok !== 'boolean' || typeof r.used !== 'number' || typeof r.lim !== 'number') throw new Error(`${fn} sent a bad row`);
    return { ok: r.ok, used: r.used, limit: r.lim };
  }

  async refund(user: string, period: string, seconds: number) {
    await this.rpc('refund_asr_seconds', { p_user: user, p_period: period, p_seconds: seconds });
  }

  async usage(user: string, period: string) {
    const fn = 'asr_usage_for';
    const r = RestAsrStore.row(fn, await this.rpc(fn, { p_user: user, p_period: period }));
    if (typeof r.used !== 'number' || typeof r.lim !== 'number' || typeof r.plan !== 'string') throw new Error(`${fn} sent a bad row`);
    return { used: r.used, limit: r.lim, plan: r.plan };
  }
}

type RestOptions = { url: string; serviceKey: string; fetch: typeof fetch };

const restHeaders = (o: RestOptions) => ({ apikey: o.serviceKey, authorization: `Bearer ${o.serviceKey}` });

async function restCall(o: RestOptions, what: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await o.fetch(`${o.url}/rest/v1/${path}`, {
    ...init,
    headers: { ...restHeaders(o), ...(init.body ? { 'content-type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${what} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const rpc = (o: RestOptions, fn: string, body: object) => restCall(o, fn, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });

/** A table-returning function sends [] or [row]; the field of the first row, else null. */
function firstField(fn: string, v: unknown, field: string, kind: 'string' | 'number' | 'boolean'): string | number | boolean | null {
  if (!Array.isArray(v)) throw new Error(`${fn} sent a bad reply`);
  if (!v.length) return null;
  const x = (v[0] as Record<string, unknown> | null)?.[field];
  if (x === null || x === undefined) return null;
  if (typeof x !== kind) throw new Error(`${fn} sent a bad row`);
  return x as string | number;
}

/** The one-clone-per-account table through the REST API (voice_clone_* functions, polished-audio migration). */
export class RestCloneStore implements CloneStore {
  constructor(private readonly o: RestOptions) {}

  async get(user: string) {
    return firstField('voice_clone_get', await rpc(this.o, 'voice_clone_get', { p_user: user }), 'voice_id', 'string') as string | null;
  }

  async count() {
    const n = firstField('voice_clone_count', await rpc(this.o, 'voice_clone_count', {}), 'n', 'number');
    if (n === null) throw new Error('voice_clone_count sent no row');
    return n as number;
  }

  async put(user: string, voiceId: string) {
    return firstField('voice_clone_put', await rpc(this.o, 'voice_clone_put', { p_user: user, p_voice_id: voiceId }), 'old_voice_id', 'string') as string | null;
  }

  async remove(user: string) {
    return firstField('voice_clone_delete', await rpc(this.o, 'voice_clone_delete', { p_user: user }), 'voice_id', 'string') as string | null;
  }
}

/** Polished audio's database side; the upload needs Storage, so the function's entry adds it. */
export class RestSpeakFiles implements Omit<SpeakFiles, 'upload'> {
  constructor(private readonly o: RestOptions) {}

  async owns(user: string, noteId: string) {
    const q = `user_id=eq.${encodeURIComponent(user)}&entity=eq.note&id=eq.${encodeURIComponent(noteId)}&deleted=eq.false&select=id`;
    const rows = await restCall(this.o, 'sync_rows', `sync_rows?${q}`);
    return Array.isArray(rows) && rows.length === 1;
  }

  async reserve(user: string, path: string, bytes: number) {
    const ok = firstField('storage_reserve', await rpc(this.o, 'storage_reserve', { p_user: user, p_bucket: 'audio', p_name: path, p_size: bytes }), 'ok', 'boolean');
    return ok === true;
  }
}
