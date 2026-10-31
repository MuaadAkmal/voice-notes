import { useEffect, useRef, useState } from 'react';
import type { HomeWidget } from '../../shared/channels';
import { cleanIpcError } from '../../shared/format';
import { isPinned, pinPage, unpinPage } from '../../shared/home-widgets';
import { useToast } from './Toast';

const api = window.dashboardApi;
export const HOME_FULL = 'Home is full (24 widgets)';

/** The `homeWidgets` setting, kept current, and edits that always start from the latest list. */
export function useHomeWidgets() {
  const toast = useToast();
  const [widgets, setWidgets] = useState<HomeWidget[] | null>(null);
  // The latest list (from settings:changed, or our own pending write); every edit starts from it.
  const latest = useRef<HomeWidget[]>([]);
  // Until the first load, `latest` is not the stored list, and saving it would wipe Home.
  const loaded = useRef(false);
  const apply = (ws: HomeWidget[]) => {
    loaded.current = true;
    latest.current = ws;
    setWidgets(ws);
  };
  const load = () => api.getSettings().then((s) => apply(s.homeWidgets));

  useEffect(() => {
    load();
    return api.onSettingsChanged(load);
  }, []);

  /** Applies `update` to the latest list and saves it (no-op before the first load). Rejects on failure (after reloading). */
  const save = async (update: (cur: HomeWidget[]) => HomeWidget[]) => {
    if (!loaded.current) return;
    // Taken as the latest at once, so a second edit before this one lands builds on it.
    const next = update(latest.current);
    latest.current = next;
    try {
      apply((await api.setSettings({ homeWidgets: next })).homeWidgets);
    } catch (e) {
      load();
      throw e;
    }
  };
  /** `save`, with failures shown as a toast. */
  const run = (update: (cur: HomeWidget[]) => HomeWidget[]) =>
    save(update).catch((e) => toast(cleanIpcError(e)));

  /** Pins the page to Home, or unpins it if it already is. */
  const togglePin = (pageId: string) =>
    run((cur) =>
      isPinned(cur, pageId)
        ? unpinPage(cur, pageId)
        : pinPage(cur, pageId, crypto.randomUUID()),
    );

  return { widgets, save, run, togglePin };
}
