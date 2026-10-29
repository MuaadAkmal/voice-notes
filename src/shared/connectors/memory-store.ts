import type { CallbackResult } from './protocol';
import { type ConnectorRow, type ConnectorStore, type Provider, type StateRow, TAKEN } from './store';

/** The connector store in memory: unit tests and the e2e fixture server. */
export class MemoryConnectorStore implements ConnectorStore {
  private readonly states = new Map<string, StateRow & { result: string | null }>();
  private readonly rows = new Map<string, ConnectorRow>();

  async putState(s: StateRow): Promise<void> {
    this.states.set(s.state, { ...s, result: null });
  }

  async takeState(state: string, now: number): Promise<{ userId: string; provider: Provider } | null> {
    const s = this.states.get(state);
    if (!s || s.result !== null || s.expiresAt <= now) return null;
    s.result = TAKEN;
    return { userId: s.userId, provider: s.provider };
  }

  async finishState(state: string, result: CallbackResult): Promise<void> {
    const s = this.states.get(state);
    if (s) s.result = result;
  }

  async stateResult(userId: string, state: string): Promise<CallbackResult | null> {
    const s = this.states.get(state);
    return s && s.userId === userId && s.result !== null && s.result !== TAKEN ? (s.result as CallbackResult) : null;
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
