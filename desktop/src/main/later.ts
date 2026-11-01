import type { CaptureResult, DropPayload, DropResult, Settings } from '../shared/channels';
import { ensureLocked } from '../shared/home-widgets';
import { captureLine } from '../shared/capture-line';
import { LATER_PAGE_TITLE, laterEntry, parseDrop } from '../shared/later';
import { pageFor } from '../shared/later-routes';
import type { Capture } from './commands/capture';
import type { Described } from './commands/describe';
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

/**
 * Every settings patch carrying widgets goes through this: only the Review later page's card may be
 * locked, and it is always present. Uses the patch's own laterPageId when it carries a new one.
 */
export function guardWidgets(patch: Partial<Settings>, settings: Settings, newId: () => string): Partial<Settings> {
  const lockId = patch.laterPageId ?? settings.laterPageId;
  if (!patch.homeWidgets || !lockId) return patch;
  // A locked card for another page is a leftover from a recreated Review later page (or forged): drop it.
  const kept = patch.homeWidgets.filter((w) => !w.locked || w.pageId === lockId);
  return { ...patch, homeWidgets: ensureLocked(kept, lockId, newId()) };
}

type DropDeps = {
  pages: PageStore;
  getSettings(): Settings;
  updateSettings(patch: Partial<Settings>): Settings;
  source(): string | null; // show label of the window the drag came from
  window(): { title: string; processName: string } | null; // the window in front: where the drag came from
  newId(): string;
};

type PageDeps = Pick<DropDeps, 'pages' | 'getSettings' | 'updateSettings' | 'newId'>;

/**
 * The page an entry goes on: the site's page, found by title so a page you already call "Reddit" is
 * used and a deleted one comes back (made here on first use; the oldest if two PCs each made one),
 * or Review later when no site matched.
 */
function targetPage(name: string | null, deps: PageDeps): { id: string; title: string } {
  if (name) {
    const key = name.toLowerCase();
    const [existing] = deps.pages
      .list()
      .filter((p) => p.title.trim().toLowerCase() === key)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (existing) return { id: existing.id, title: existing.title };
    const id = deps.pages.create(null).id;
    deps.pages.rename(id, name);
    return { id, title: name };
  }
  const patch = ensureLaterPage(deps.getSettings(), deps.pages, deps.newId);
  const { laterPageId } = patch ? deps.updateSettings(patch) : deps.getSettings();
  return { id: laterPageId!, title: LATER_PAGE_TITLE };
}

/** Appends a drop to its app's page, or Review later. Throws if the append fails. */
export function saveDrop(payload: DropPayload, deps: DropDeps): DropResult {
  const item = parseDrop(payload);
  if (!item) return { kind: 'ignored' };
  const page = targetPage(pageFor(item.kind === 'link' ? item.url : null, deps.window(), deps.getSettings().laterSites), deps);
  deps.pages.appendEntry(page.id, laterEntry(item, deps.source()));
  return { kind: 'saved', page: page.title };
}

type CaptureDeps = PageDeps & {
  capture(): Capture | null; // the window in front, never our own
  describe(c: Capture): Promise<Described>;
  saveImage(bytes: Uint8Array): Promise<string>; // vn-image:// src
};

/**
 * The pill's "Save this" button: the window in front (the overlay never takes focus) becomes an
 * entry on its app's page or Review later, as "Pixie, add this to …" would write it. Nothing in front, or only the
 * desktop, saves nothing. Throws if the append fails.
 */
export async function saveCapture(deps: CaptureDeps): Promise<CaptureResult> {
  const c = deps.capture();
  if (!c || (c.processName.toLowerCase().replace(/\.exe$/, '') === 'explorer' && c.title === 'Program Manager')) return { kind: 'nothing' };
  const d = await deps.describe(c);
  const imageSrc = d.image ? await deps.saveImage(d.image).catch(() => undefined) : undefined;
  const line = captureLine({ label: d.label, app: d.app, url: d.url, path: d.path, imageSrc });
  const page = targetPage(pageFor(d.url, c, deps.getSettings().laterSites), deps);
  deps.pages.appendEntry(page.id, `[ ] ${line}`);
  return { kind: 'saved', label: d.label, page: page.title };
}
