import type { Page } from '../../shared/channels';
import { removeLastLines } from '../../shared/list-lines';

// Undo / Move to… for what a voice-to-lists command just wrote. Kept in memory on this PC only,
// briefly: the pill offers it for a few seconds. Lines go back out through an ordinary body edit,
// the same as deleting them by hand, so sync needs nothing new.

const KEEP = 5;
const KEEP_MS = 2 * 60_000;
const OFFER = 50;
const GONE = 'Already changed';

type Action = { id: string; pageId: string; lines: string[]; at: number };

export type UndoOffer = { id: string; pages: { id: string; title: string }[] };

export class ListUndo {
  private actions: Action[] = [];
  private seq = 0;

  constructor(
    private readonly d: {
      pages: { get(id: string): Page | undefined; list(): Page[]; setBody(id: string, body: string): Page; appendLine(id: string, text: string): Page };
      pagesChanged(): void;
      now(): number;
    },
  ) {}

  /** Registers lines just appended to `pageId`; returns the id the pill's buttons send back. */
  remember(pageId: string, lines: string[]): string {
    const id = `u${++this.seq}`;
    this.actions = [...this.live(), { id, pageId, lines, at: this.d.now() }].slice(-KEEP);
    return id;
  }

  /** What the pill shows for the action: the pages it may be moved to. Null once gone. */
  offer(id: string): UndoOffer | null {
    const a = this.find(id);
    if (!a) return null;
    const pages = this.d.pages
      .list()
      .filter((p) => p.id !== a.pageId)
      .slice(0, OFFER)
      .map((p) => ({ id: p.id, title: p.title }));
    return { id, pages };
  }

  undo(id: string): string {
    const a = this.take(id);
    if (!a) return GONE;
    return this.takeBack(a).length ? 'Undone' : GONE;
  }

  move(id: string, pageId: string): string {
    if (!this.offer(id)?.pages.some((p) => p.id === pageId)) return GONE;
    const a = this.take(id)!;
    const target = this.d.pages.get(pageId);
    if (!target) return GONE;
    const lines = this.takeBack(a);
    if (!lines.length) return GONE;
    for (const line of lines) this.d.pages.appendLine(pageId, line);
    this.d.pagesChanged();
    return `Moved → ${target.title || 'Untitled'}`;
  }

  /** Removes the action's lines from its page; returns the ones that were still there. */
  private takeBack(a: Action): string[] {
    const page = this.d.pages.get(a.pageId);
    if (!page) return [];
    const { body, removed } = removeLastLines(page.body, a.lines);
    if (!removed.length) return [];
    this.d.pages.setBody(a.pageId, body);
    this.d.pagesChanged();
    return removed;
  }

  private live(): Action[] {
    const now = this.d.now();
    return this.actions.filter((a) => now - a.at <= KEEP_MS);
  }

  private find(id: string): Action | undefined {
    return this.live().find((a) => a.id === id);
  }

  private take(id: string): Action | undefined {
    const a = this.find(id);
    this.actions = this.actions.filter((x) => x.id !== id);
    return a;
  }
}
