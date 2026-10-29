import type { CallbackResult } from './protocol';
import { type ConnectorRow, type ConnectorStore, type Provider, type StateRow, TAKEN } from './store';

/** The slice of a Postgres client the store needs (postgres.js in the function, PGlite in tests). */
export type ConnectorDb = { query<T>(text: string, params?: unknown[]): Promise<T[]> };

type Row = {
  user_id: string;
  provider: Provider;
  account_email: string;
  refresh_token: string;
  scopes: string;
  connected_at: Date | string;
};

/** The connector tables on Postgres. Every row query is scoped by user_id. */
export class PgConnectorStore implements ConnectorStore {
  constructor(private readonly db: ConnectorDb) {}

  async putState(s: StateRow): Promise<void> {
    await this.db.query(
      'insert into public.connector_states (state, user_id, provider, expires_at) values ($1, $2, $3, $4)',
      [s.state, s.userId, s.provider, new Date(s.expiresAt).toISOString()],
    );
  }

  async takeState(state: string, now: number): Promise<{ userId: string; provider: Provider } | null> {
    // One update, so two callbacks with the same state can't both take it.
    const rows = await this.db.query<{ user_id: string; provider: Provider }>(
      `update public.connector_states set result = $3 where state = $1 and result is null and expires_at > $2
       returning user_id, provider`,
      [state, new Date(now).toISOString(), TAKEN],
    );
    const r = rows[0];
    return r ? { userId: r.user_id, provider: r.provider } : null;
  }

  async finishState(state: string, result: CallbackResult): Promise<void> {
    await this.db.query('update public.connector_states set result = $2 where state = $1', [state, result]);
  }

  async stateResult(userId: string, state: string): Promise<CallbackResult | null> {
    const rows = await this.db.query<{ result: string | null }>(
      'select result from public.connector_states where state = $1 and user_id = $2',
      [state, userId],
    );
    const r = rows[0]?.result;
    return r && r !== TAKEN ? (r as CallbackResult) : null;
  }

  async deleteExpiredStates(now: number): Promise<void> {
    await this.db.query('delete from public.connector_states where expires_at <= $1', [new Date(now).toISOString()]);
  }

  async get(userId: string, provider: Provider): Promise<ConnectorRow | null> {
    const rows = await this.db.query<Row>(
      'select user_id, provider, account_email, refresh_token, scopes, connected_at from public.connectors where user_id = $1 and provider = $2',
      [userId, provider],
    );
    const r = rows[0];
    return r
      ? {
          userId: r.user_id,
          provider: r.provider,
          accountEmail: r.account_email,
          refreshToken: r.refresh_token,
          scopes: r.scopes,
          connectedAt: new Date(r.connected_at).getTime(),
        }
      : null;
  }

  async put(row: ConnectorRow): Promise<void> {
    await this.db.query(
      `insert into public.connectors (user_id, provider, account_email, refresh_token, scopes, connected_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id, provider) do update set account_email = excluded.account_email,
         refresh_token = excluded.refresh_token, scopes = excluded.scopes, connected_at = excluded.connected_at`,
      [row.userId, row.provider, row.accountEmail, row.refreshToken, row.scopes, new Date(row.connectedAt).toISOString()],
    );
  }

  async delete(userId: string, provider: Provider): Promise<void> {
    await this.db.query('delete from public.connectors where user_id = $1 and provider = $2', [userId, provider]);
  }
}
