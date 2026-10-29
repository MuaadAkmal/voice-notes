import type { CallbackResult } from './protocol';

// What the `connectors` Edge Function keeps per account: one row per connected provider (its refresh
// token sealed by the function) and the one-time states of consent round trips in flight.

export type Provider = 'google-calendar';

export type ConnectorRow = {
  userId: string;
  provider: Provider;
  accountEmail: string; // the Google account that consented
  refreshToken: string; // sealed by TokenCipher, never plain
  scopes: string;
  connectedAt: number;
};

export type StateRow = { state: string; userId: string; provider: Provider; expiresAt: number };

/** A state Google came back with, before its outcome is recorded. */
export const TAKEN = 'taken';

export interface ConnectorStore {
  putState(s: StateRow): Promise<void>;
  /** Marks the state used and says whose it was; null when unknown, used, or past `expiresAt`. */
  takeState(state: string, now: number): Promise<{ userId: string; provider: Provider } | null>;
  /** Records how the round trip ended, for the app that started it to read. */
  finishState(state: string, result: CallbackResult): Promise<void>;
  /** The recorded end of `userId`'s round trip; null while it is still going (or not theirs). */
  stateResult(userId: string, state: string): Promise<CallbackResult | null>;
  deleteExpiredStates(now: number): Promise<void>;
  get(userId: string, provider: Provider): Promise<ConnectorRow | null>;
  /** Insert or replace the (userId, provider) row. */
  put(row: ConnectorRow): Promise<void>;
  delete(userId: string, provider: Provider): Promise<void>;
}
