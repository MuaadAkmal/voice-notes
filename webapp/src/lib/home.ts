import type { Snapshot } from "@/sync/store";

// The Home cards the web shows, from the synced `homeWidgets` setting the PCs edit. Calendar and
// reminders cards are left out: reminders live on one PC, and the web has no Google Calendar.
export type HomeCard = { id: string; type: "page" | "quick-add"; pageId: string; w: number; h: number };

const span = (n: unknown) => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 4 ? (n as number) : null);

/** Cards in the PCs' order, for pages this account still has; sizes as the desktop gives them. */
export function homeCards(snap: Snapshot): HomeCard[] {
  if (!Array.isArray(snap.homeWidgets)) return [];
  const cards: HomeCard[] = [];
  for (const w of snap.homeWidgets as unknown[]) {
    if (!w || typeof w !== "object") continue;
    const { id, type, pageId, w: cols, h: rows } = w as Record<string, unknown>;
    if ((type !== "page" && type !== "quick-add") || typeof id !== "string" || typeof pageId !== "string" || !snap.pages.has(pageId)) continue;
    const stored = span(cols) && span(rows);
    cards.push({ id, type, pageId, w: stored ? (cols as number) : type === "quick-add" ? 1 : 2, h: stored ? (rows as number) : 2 });
  }
  return cards;
}
