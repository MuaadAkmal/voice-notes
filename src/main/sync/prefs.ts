import type { Settings } from '../../shared/channels';
import { SYNCED_KEYS, type SyncedKey } from '../../shared/sync-ops';
import type { PageStore } from '../store/page-store';
import type { Outbox } from './outbox';

/** Queues the account-wide settings in a patch; device settings (hotkeys, theme, …) never leave this PC. */
export function recordPrefs(patch: Partial<Settings>, outbox: Outbox): void {
  for (const key of SYNCED_KEYS) {
    if (key in patch) outbox.record({ op: 'prefs.set', key, value: patch[key] }, 0);
  }
}

/**
 * Both PCs made their own built-in Review later page; the account's one wins. Ours stays as a normal
 * page (renamed, so nothing saved to it is lost) and the locked Home card moves to the winner.
 */
export function mergeLaterPage(local: Settings, remoteId: string, pages: PageStore, deviceName: string): Partial<Settings> {
  if (local.laterPageId && local.laterPageId !== remoteId && pages.get(local.laterPageId)) {
    pages.rename(local.laterPageId, `Review later (${deviceName})`);
  }
  const homeWidgets = local.homeWidgets
    // a plain card for the winning page would now duplicate the locked one
    .filter((w) => w.locked || !(w.type === 'page' && w.pageId === remoteId))
    .map((w) => (w.locked && w.type === 'page' ? { ...w, pageId: remoteId } : w));
  return { laterPageId: remoteId, homeWidgets };
}

type PrefsDeps = {
  getSettings(): Settings;
  updateSettings(patch: Partial<Settings>, opts?: { record?: boolean }): Settings;
  pages: PageStore;
  deviceName: string;
};

/** Settings pulled from the account, applied without being queued back. The Review later page first, so the Home layout that follows refers to the right page. */
export function applyRemotePrefs(prefs: { key: SyncedKey; value: unknown }[], d: PrefsDeps): void {
  const ordered = [...prefs].sort((a, b) => Number(b.key === 'laterPageId') - Number(a.key === 'laterPageId'));
  for (const { key, value } of ordered) {
    const current = d.getSettings();
    if (key === 'laterPageId') {
      if (typeof value !== 'string' || value === current.laterPageId) continue;
      d.updateSettings(mergeLaterPage(current, value, d.pages, d.deviceName), { record: false });
    } else {
      d.updateSettings({ [key]: value } as Partial<Settings>, { record: false });
    }
  }
}
