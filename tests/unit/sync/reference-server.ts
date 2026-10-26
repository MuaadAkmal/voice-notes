import { randomUUID } from 'node:crypto';
import { MemoryStore, toServerRow } from '../../../src/shared/sync/memory-store';
import type { PullRequest, PullResponse, PushRequest, PushResponse, ServerRow, SyncServer } from '../../../src/shared/sync/protocol';
import { type Entity, SyncCore } from '../../../src/shared/sync/server-core';

// The sync server's rules in memory, for one account: SyncCore over MemoryStore. The Edge Function
// runs the same SyncCore over Postgres (docs/superpowers/specs/2026-10-27-sync-rows-design.md).

const USER = 'u1';

export class ReferenceServer implements SyncServer {
  private readonly store = new MemoryStore();
  private readonly core = new SyncCore(this.store, randomUUID);
  private dropAck = false;

  /** The next push is applied but answered with an error, as if the connection dropped. */
  dropNextAck(): void {
    this.dropAck = true;
  }

  rows(): ServerRow[] {
    return this.store.rows(USER).map(toServerRow);
  }

  row<E extends Entity>(entity: E, id: string): Extract<ServerRow, { entity: E }> | undefined {
    return this.rows().find((r) => r.entity === entity && r.id === id) as Extract<ServerRow, { entity: E }> | undefined;
  }

  async push(req: PushRequest): Promise<PushResponse> {
    const res = await this.core.push(USER, req);
    if (this.dropAck) {
      this.dropAck = false;
      throw new Error('connection lost');
    }
    return res;
  }

  pull(req: PullRequest): Promise<PullResponse> {
    return this.core.pull(USER, req);
  }
}
