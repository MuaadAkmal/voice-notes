import { useEffect, useState } from 'react';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from './Toast';
import { syncedAgo, useSync } from './useSync';

const api = window.dashboardApi;

/** The Account page's sync section: the one-time question, then the switch, status and Sync now. */
export function SyncCard() {
  const toast = useToast();
  const view = useSync();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000); // keeps "N min ago" fresh
    return () => clearInterval(t);
  }, []);

  if (!view) return null;
  const run = (p: Promise<void>) => p.catch((e) => toast(cleanIpcError(e)));
  const { status } = view;
  const on = status.mode !== 'off';

  if (view.needsPrompt) {
    return (
      <div className="mt-4 rounded-2xl border bg-card p-5">
        <div className="text-base font-medium">Sync this PC with your account?</div>
        <p className="mt-1 text-sm text-muted-foreground">Notes, pages, folders and your Home layout. Audio and images come next.</p>
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => run(api.turnOnSync())}>
            Turn on
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run(api.dismissSyncPrompt())}>
            Not now
          </Button>
        </div>
      </div>
    );
  }

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
              : 'Off on this PC';

  return (
    <div className="mt-4 rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <label htmlFor="sync-switch" className="text-base font-medium">
            Sync this PC
          </label>
          <p className={`mt-0.5 text-sm ${status.mode === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{line}</p>
        </div>
        <Switch
          id="sync-switch"
          aria-label="Sync this PC"
          checked={on}
          onCheckedChange={(checked) => run(checked ? api.turnOnSync() : api.turnOffSync())}
        />
      </div>
      {on && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="outline" disabled={status.mode === 'syncing'} onClick={() => run(api.syncNow())}>
            {status.mode === 'error' ? 'Retry' : 'Sync now'}
          </Button>
        </div>
      )}
    </div>
  );
}
