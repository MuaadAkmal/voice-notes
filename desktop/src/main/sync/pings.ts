import type { SupabaseClient } from '@supabase/supabase-js';

// Instant updates from the account's other PCs: after a push the `sync` function broadcasts on the
// private topic sync:<user_id>, and this PC syncs at once instead of on its timer. A convenience: a
// missed ping only means waiting for the next timer sync, so nothing here retries or reports.

export type PingSource = {
  /** Start listening; returns stop. onConnected fires on the first connect and every reconnect. */
  listen(userId: string, onPing: (from: string) => void, onConnected: () => void): () => void;
};

export class SyncPings {
  private userId: string | null = null;
  private stop: (() => void) | null = null;

  constructor(private readonly d: { source: PingSource; selfId: () => string; onRemoteChange: () => void }) {}

  /** Listen to this user's topic, or to none. */
  update(userId: string | null): void {
    if (userId === this.userId) return;
    this.stop?.();
    this.stop = null;
    this.userId = userId;
    if (!userId) return;
    // A callback from a channel already stopped (late message, reconnect) is ignored.
    const live = () => this.userId === userId;
    this.stop = this.d.source.listen(
      userId,
      (from) => {
        if (live() && from !== this.d.selfId()) this.d.onRemoteChange();
      },
      () => {
        if (live()) this.d.onRemoteChange(); // catches up on pings missed while disconnected
      },
    );
  }
}

/** Realtime through main's supabase-js client, which keeps the channel's token fresh. */
export function supabasePings(client: SupabaseClient): PingSource {
  return {
    listen(userId, onPing, onConnected) {
      const channel = client
        .channel(`sync:${userId}`, { config: { private: true } })
        .on('broadcast', { event: 'changed' }, (msg) => onPing(String(msg.payload?.from ?? '')))
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onConnected();
        });
      return () => void client.removeChannel(channel);
    },
  };
}
