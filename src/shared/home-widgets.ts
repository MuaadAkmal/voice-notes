import type { HomeWidget } from './channels';

export const MAX_HOME_WIDGETS = 24;

/** The locked Review later card doesn't count against the cap. */
export const canAdd = (ws: HomeWidget[]): boolean =>
  ws.filter((w) => !w.locked).length < MAX_HOME_WIDGETS;

export const addWidget = (ws: HomeWidget[], w: HomeWidget): HomeWidget[] =>
  canAdd(ws) ? [...ws, w] : ws;

export const removeWidget = (ws: HomeWidget[], id: string): HomeWidget[] =>
  ws.filter((w) => w.id !== id || w.locked);

/** Puts the locked page widget for `pageId` first unless it's already there (even on a full Home). */
export const ensureLocked = (
  ws: HomeWidget[],
  pageId: string,
  newId: string,
): HomeWidget[] =>
  ws.some((w) => w.locked && w.pageId === pageId)
    ? ws
    : [{ id: newId, type: 'page', pageId, locked: true }, ...ws];

/** Sets a quick-add widget's label; page widgets have none. */
export const renameWidget = (
  ws: HomeWidget[],
  id: string,
  label: string,
): HomeWidget[] =>
  ws.map((w) => (w.id === id && w.type === 'quick-add' ? { ...w, label } : w));

/** Only `page` widgets count: a quick-add box for a page is not a pin. */
export const isPinned = (ws: HomeWidget[], pageId: string): boolean =>
  ws.some((w) => w.type === 'page' && w.pageId === pageId);

export const pinPage = (
  ws: HomeWidget[],
  pageId: string,
  newId: string,
): HomeWidget[] =>
  isPinned(ws, pageId)
    ? ws
    : addWidget(ws, { id: newId, type: 'page', pageId });

/** Removes the page's `page` widgets (never the locked card); its quick-add boxes stay. */
export const unpinPage = (ws: HomeWidget[], pageId: string): HomeWidget[] =>
  ws.filter((w) => w.locked || !(w.type === 'page' && w.pageId === pageId));

/** The built-in Review later page: the one the locked card shows. */
export const builtInPageId = (ws: HomeWidget[] | null): string | null =>
  ws?.find((w) => w.locked)?.pageId ?? null;

/** Drops every widget (any type) whose page was deleted. */
export const pruneWidgets = (
  ws: HomeWidget[],
  deletedPageIds: string[],
): HomeWidget[] => {
  const gone = new Set(deletedPageIds);
  return ws.filter((w) => !gone.has(w.pageId));
};

/** Keeps only widgets whose page is in `pageIds`; the rest are orphans. */
export const keepExisting = (
  ws: HomeWidget[],
  pageIds: string[],
): HomeWidget[] => {
  const live = new Set(pageIds);
  return ws.filter((w) => live.has(w.pageId));
};

/** Moves widget `id` so it ends up at `toIndex` (clamped); unknown id is a no-op. */
export const moveWidget = (
  ws: HomeWidget[],
  id: string,
  toIndex: number,
): HomeWidget[] => {
  const from = ws.findIndex((w) => w.id === id);
  if (from < 0) return ws;
  const next = ws.filter((w) => w.id !== id);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, ws[from]);
  return next;
};

/** Home is a grid of this many columns; a widget spans 1..MAX_SPAN columns and rows. */
export const GRID_COLUMNS = 4;
export const MAX_SPAN = 4;

const clampSpan = (n: number) => Math.max(1, Math.min(MAX_SPAN, Math.round(n)));

/** Stored size, or the default for its type (older settings have none). */
export const widgetSize = (w: HomeWidget): { w: number; h: number } =>
  w.w && w.h
    ? { w: w.w, h: w.h }
    : w.type === 'quick-add'
      ? { w: 1, h: 2 }
      : { w: 2, h: 2 };

export const resizeWidget = (
  ws: HomeWidget[],
  id: string,
  w: number,
  h: number,
): HomeWidget[] =>
  ws.map((x) => (x.id === id ? { ...x, w: clampSpan(w), h: clampSpan(h) } : x));

/** How many grid cells a length of `px` covers, given the cell size and the gap between cells. */
export const spanFor = (px: number, cell: number, gap: number): number =>
  clampSpan((px + gap) / (cell + gap));
