import type { ConnectorRow, ConnectorStore, Provider, StateRow } from './store';

/** The connector store in memory: unit tests and the e2e fixture server. */
export class MemoryConnectorStore implements ConnectorStore {
  private readonly states = new Map<string, StateRow>();
  private readonly rows = new Map<string, ConnectorRow>();

  async putState(s: StateRow): Promise<void> {
    this.states.set(s.state, { ...s });
  }

  async takeState(state: string, now: number): Promise<{ userId: string; provider: Provider } | null> {
    const s = this.states.get(state);
    this.states.delete(state);
    return s && s.expiresAt > now ? { userId: s.userId, provider: s.provider } : null;
  }

  async deleteExpiredStates(now: number): Promise<void> {
    for (const [k, s] of this.states) if (s.expiresAt <= now) this.states.delete(k);
  }

  async get(userId: string, provider: Provider): Promise<ConnectorRow | null> {
    const r = this.rows.get(key(userId, provider));
    return r ? { ...r } : null;
  }

  async put(row: ConnectorRow): Promise<void> {
    this.rows.set(key(row.userId, row.provider), { ...row });
  }

  async delete(userId: string, provider: Provider): Promise<void> {
    this.rows.delete(key(userId, provider));
  }
}

const key = (userId: string, provider: Provider) => `${userId}\u0000${provider}`;
