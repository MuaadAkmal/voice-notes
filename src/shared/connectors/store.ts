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

export interface ConnectorStore {
  putState(s: StateRow): Promise<void>;
  /** Removes the state and says whose it was; null when unknown or past `expiresAt`. */
  takeState(state: string, now: number): Promise<{ userId: string; provider: Provider } | null>;
  deleteExpiredStates(now: number): Promise<void>;
  get(userId: string, provider: Provider): Promise<ConnectorRow | null>;
  /** Insert or replace the (userId, provider) row. */
  put(row: ConnectorRow): Promise<void>;
  delete(userId: string, provider: Provider): Promise<void>;
}
