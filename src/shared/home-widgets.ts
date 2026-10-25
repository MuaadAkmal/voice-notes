import type { HomeWidget } from './channels';

export const MAX_HOME_WIDGETS = 24;

export const canAdd = (ws: HomeWidget[]): boolean =>
  ws.length < MAX_HOME_WIDGETS;

export const addWidget = (ws: HomeWidget[], w: HomeWidget): HomeWidget[] =>
  canAdd(ws) ? [...ws, w] : ws;

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

/** Removes the page's `page` widgets; its quick-add boxes stay. */
export const unpinPage = (ws: HomeWidget[], pageId: string): HomeWidget[] =>
  ws.filter((w) => !(w.type === 'page' && w.pageId === pageId));

/** Drops every widget (any type) whose page was deleted. */
export const pruneWidgets = (
  ws: HomeWidget[],
  deletedPageIds: string[],
): HomeWidget[] => {
  const gone = new Set(deletedPageIds);
  return ws.filter((w) => !gone.has(w.pageId));
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
