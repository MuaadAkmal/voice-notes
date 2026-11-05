import { useEffect, useState } from 'react';
import { PLAN_PAGE_URL, quotaState, storageText } from '../../shared/cloud-usage';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { useToast } from './Toast';
import { syncedAgo, useSync } from './useSync';

const api = window.dashboardApi;

/** Amber from 80% of the plan's storage, red once it's full (as the Cloud card's minutes bar). */
const BAR = { ok: 'bg-primary', low: 'bg-amber-500', out: 'bg-destructive' } as const;

/** "180 MB of 250 MB" of synced audio and images, with Upgrade once it's getting full. */
function StorageBar({ used, limit }: { used: number; limit: number }) {
  const toast = useToast();
  const state = quotaState({ used, limit });
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Cloud storage · {storageText({ used, limit })}</span>
        {state !== 'ok' && (
          <Button size="sm" onClick={() => api.openExternal(PLAN_PAGE_URL).catch((e) => toast(cleanIpcError(e)))}>
            Upgrade
          </Button>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Cloud storage"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={`h-full rounded-full ${BAR[state]}`} style={{ width: `${limit > 0 ? Math.min(100, (used / limit) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

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
      {on && view.storage && <StorageBar used={view.storage.used} limit={view.storage.limit} />}
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
