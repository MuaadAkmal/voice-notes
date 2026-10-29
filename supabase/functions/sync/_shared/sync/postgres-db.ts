import type { Db } from './pg-store.ts';

/** The minimal slice of a postgres.js `sql` instance (or transaction) that `Db` needs. */
export type PostgresJs = {
  unsafe(query: string, params?: unknown[]): PromiseLike<unknown>;
  begin?<T>(fn: (tx: PostgresJs) => Promise<T>): PromiseLike<T>;
};

/** `Db` over postgres.js: what the Edge Function uses (and what the wire-protocol tests run). */
export function postgresDb(q: PostgresJs): Db {
  return {
    query: async <T>(text: string, params: unknown[] = []) => (await q.unsafe(text, params)) as T[],
    transaction: (fn) => (q.begin ? (q.begin((tx) => fn(postgresDb(tx))) as Promise<never>) : fn(postgresDb(q))),
  };
}
