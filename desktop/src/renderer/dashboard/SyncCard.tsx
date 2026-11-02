import { useEffect, useState } from 'react';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { useToast } from './Toast';
import { syncedAgo, useSync } from './useSync';

const api = window.dashboardApi;

/** The Account page's sync section: this PC always syncs the account, so just its status and Sync now. */
export function SyncCard() {
  const toast = useToast();
  const view = useSync();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000); // keeps "N min ago" fresh
    return () => clearInterval(t);
  }, []);

  if (!view) return null;
  const { status } = view;
  const on = status.mode !== 'off';

  const line =
    status.mode === 'idle'
      ? syncedAgo(status.lastSyncedAt, now)
      : status.mode === 'syncing'
        ? 'Syncing…'
        : status.mode === 'offline'
          ? 'Offline, will retry'
          : status.mode === 'error'
            ? `Couldn't sync: ${status.message}`
            : status.mode === 'paused'
              ? 'Paused while signed out'
              : 'Not syncing';

  return (
    <div className="mt-4 rounded-2xl border bg-card p-5">
      <div className="text-base font-medium">Sync</div>
      <p className={`mt-0.5 text-sm ${status.mode === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{line}</p>
      {on && view.filesWaiting > 0 && <p className="mt-0.5 text-sm text-muted-foreground">Uploading {view.filesWaiting} recordings…</p>}
      {on && view.storageFull && <p className="mt-0.5 text-sm text-destructive">Cloud storage is full. New audio stays on this PC.</p>}
      {on && (
        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={status.mode === 'syncing'}
            onClick={() => api.syncNow().catch((e) => toast(cleanIpcError(e)))}
          >
            {status.mode === 'error' ? 'Retry' : 'Sync now'}
          </Button>
        </div>
      )}
    </div>
  );
}
