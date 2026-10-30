import { LIMITS, type ResolveRequest, type ResolveResponse } from '../../shared/commands/protocol';
import type { Page } from '../../shared/channels';
import { AuthExpired, NotSignedIn, Offline } from '../sync/http-server';
import { LimitReached } from './client';

// Voice to lists, app side: sends the command and this PC's page titles to the `commands` function,
// then writes the items itself, and only to a page it sent. Whatever can't be placed (no page fits,
// offline, signed out) lands in the built-in Quick notes page, so a "Note, …" is never lost or pasted.

type Deps = {
  resolve(req: ResolveRequest): Promise<ResolveResponse>;
  pages: { list(): Page[]; get(id: string): Page | undefined; appendLine(id: string, text: string): Page };
  /** The Quick notes page's id, creating the page first if it is gone. */
  quickNotes(): string;
  pagesChanged(): void;
};

export type ListResult = { ok: boolean; message: string };

export class ListCommands {
  constructor(private readonly d: Deps) {}

  async add(text: string): Promise<ListResult> {
    const fallback = this.d.quickNotes();
    // Most recently changed first, so a PC with very many pages still sends the ones in use.
    const pages = this.d.pages.list().slice(0, LIMITS.pages);
    let r: ResolveResponse;
    try {
      r = await this.d.resolve({
        text: text.slice(0, LIMITS.text),
        pages: pages.map((p) => ({ id: p.id, title: p.title.slice(0, LIMITS.title) })),
      });
    } catch (err) {
      return this.save(fallback, [text], failureText(err));
    }
    if (r.action === 'append' && pages.some((p) => p.id === r.pageId) && this.d.pages.get(r.pageId)) return this.save(r.pageId, r.items);
    return this.save(fallback, r.action === 'none' && r.items?.length ? r.items : [text]);
  }

  private save(pageId: string, items: string[], why?: string): ListResult {
    for (const item of items) this.d.pages.appendLine(pageId, item);
    this.d.pagesChanged();
    const page = this.d.pages.get(pageId);
    const what = items.length === 1 ? items[0] : `${items.length} items`;
    return { ok: true, message: `Added · ${what} → ${page?.title || 'Untitled'}${why ? ` (${why})` : ''}` };
  }
}

function failureText(err: unknown): string {
  if (err instanceof NotSignedIn) return 'sign in to sort into lists';
  if (err instanceof AuthExpired) return 'sign in again to sort into lists';
  if (err instanceof LimitReached) return 'daily limit reached';
  if (err instanceof Offline) return 'offline';
  return "couldn't sort it";
}
