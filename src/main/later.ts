import type { DropPayload, Settings } from '../shared/channels';
import { ensureLocked } from '../shared/home-widgets';
import { LATER_PAGE_TITLE, laterEntry, parseDrop } from '../shared/later';
import type { PageStore } from './store/page-store';

/**
 * The Review later page and its locked Home widget must always exist. Returns the settings patch
 * that makes it so (a new page id and/or widget list), or null when both are already in place.
 */
export function ensureLaterPage(settings: Settings, pages: PageStore, newId: () => string): Partial<Settings> | null {
  const patch: Partial<Settings> = {};
  let pageId = settings.laterPageId;
  if (!pageId || !pages.get(pageId)) {
    pageId = pages.create(null).id;
    pages.rename(pageId, LATER_PAGE_TITLE);
    patch.laterPageId = pageId;
  }
  // A locked widget left over from a page that was recreated would point at nothing.
  const current = settings.homeWidgets.filter((w) => !w.locked || w.pageId === pageId);
  const widgets = ensureLocked(current, pageId, newId());
  if (widgets !== current || current.length !== settings.homeWidgets.length) patch.homeWidgets = widgets;
  return Object.keys(patch).length ? patch : null;
}

type DropDeps = {
  pages: PageStore;
  getSettings(): Settings;
  updateSettings(patch: Partial<Settings>): Settings;
  source(): string | null; // show label of the window the drag came from
  newId(): string;
};

/** Appends a drop to the Review later page. Throws if the append fails. */
export function saveDrop(payload: DropPayload, deps: DropDeps): 'saved' | 'ignored' {
  const item = parseDrop(payload);
  if (!item) return 'ignored';
  const patch = ensureLaterPage(deps.getSettings(), deps.pages, deps.newId);
  const { laterPageId } = patch ? deps.updateSettings(patch) : deps.getSettings();
  deps.pages.appendEntry(laterPageId!, laterEntry(item, deps.source()));
  return 'saved';
}
