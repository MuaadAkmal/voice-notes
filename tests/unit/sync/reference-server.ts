import { randomUUID } from 'node:crypto';
import { MemoryStore, toServerRow } from '../../../src/shared/sync/memory-store';
import type { PullRequest, PullResponse, PushRequest, PushResponse, ServerRow, SyncServer } from '../../../src/shared/sync/protocol';
import { type Entity, type StoredRow, SyncCore, type SyncStore } from '../../../src/shared/sync/server-core';

// The sync server's rules for one account: SyncCore over a store. ReferenceServer keeps rows in
// memory; the Postgres tests run the same contract over PgStore (the Edge Function's store).

export const TEST_USER = '11111111-1111-4111-8111-111111111111';

export type InspectableStore = SyncStore & { rows(userId: string): Promise<StoredRow[]> | StoredRow[] };

export class TestServer implements SyncServer {
  private readonly core: SyncCore;
  private dropAck = false;

  constructor(
    private readonly store: InspectableStore,
    private readonly user = TEST_USER,
  ) {
    this.core = new SyncCore(store, randomUUID);
  }

  /** The next push is applied but answered with an error, as if the connection dropped. */
  dropNextAck(): void {
    this.dropAck = true;
  }

  async rows(): Promise<ServerRow[]> {
    return (await this.store.rows(this.user)).map(toServerRow);
  }

  async row<E extends Entity>(entity: E, id: string): Promise<Extract<ServerRow, { entity: E }> | undefined> {
    return (await this.rows()).find((r) => r.entity === entity && r.id === id) as Extract<ServerRow, { entity: E }> | undefined;
  }

  async push(req: PushRequest): Promise<PushResponse> {
    const res = await this.core.push(this.user, req);
    if (this.dropAck) {
      this.dropAck = false;
      throw new Error('connection lost');
    }
    return res;
  }

  pull(req: PullRequest): Promise<PullResponse> {
    return this.core.pull(this.user, req);
  }
}

/** The rules in memory. */
export class ReferenceServer extends TestServer {
  constructor() {
    super(new MemoryStore());
  }
}
