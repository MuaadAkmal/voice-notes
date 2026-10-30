import type { AsrStore } from './store';

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
