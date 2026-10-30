import type { UsageStore } from './store';

// public.count_command (migration *_count_command.sql) counts one command and drops the account's
// days older than 30, in one statement. Two ways to call it: a Postgres client (tests), or PostgREST
// over HTTP (the function: no connection to open per request).

/** The slice of a Postgres client the store needs (PGlite in tests). */
export type UsageDb = { query<T>(text: string, params?: unknown[]): Promise<T[]> };

export class PgUsageStore implements UsageStore {
  constructor(private readonly db: UsageDb) {}

  async increment(userId: string, day: string): Promise<number> {
    const rows = await this.db.query<{ count: number }>('select public.count_command($1, $2) as count', [userId, day]);
    return rows[0].count;
  }
}

/** The same function through the project's REST API, with the service role key (server side only). */
export class RestUsageStore implements UsageStore {
  constructor(private readonly o: { url: string; serviceKey: string; fetch: typeof fetch }) {}

  async increment(userId: string, day: string): Promise<number> {
    const res = await this.o.fetch(`${this.o.url}/rest/v1/rpc/count_command`, {
      method: 'POST',
      headers: { apikey: this.o.serviceKey, authorization: `Bearer ${this.o.serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_user: userId, p_day: day }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`count_command ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const count = await res.json();
    if (typeof count !== 'number') throw new Error('count_command sent no count');
    return count;
  }
}
