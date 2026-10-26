import { useEffect, useState } from 'react';
import type { SyncView } from '../../shared/channels';

const api = window.dashboardApi;

/** This PC's sync state and whether to ask about turning it on, kept current by main. */
export function useSync(): SyncView | null {
  const [view, setView] = useState<SyncView | null>(null);
  useEffect(() => {
    api.getSync().then(setView);
    return api.onSyncChanged(setView);
  }, []);
  return view;
}

/** "Synced just now" / "Synced 5 min ago" / … */
export function syncedAgo(at: number | null, now: number): string {
  if (at === null) return 'Not synced yet';
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'Synced just now';
  if (min < 60) return `Synced ${min} min ago`;
  const h = Math.floor(min / 60);
  return `Synced ${h} h ago`;
}
