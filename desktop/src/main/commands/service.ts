import { LIMITS, THIS_ITEM, type ResolveRequest, type ResolveResponse } from '../../shared/commands/protocol';
import { captureLine } from '../../shared/capture-line';
import type { Page } from '../../shared/channels';
import { AuthExpired, NotSignedIn, Offline } from '../sync/http-server';
import type { Capture } from './capture';
import { LimitReached } from './client';
import type { Described } from './describe';

// Voice to lists, app side: sends the command and this PC's page titles to the `commands` function,
// then writes the items itself, and only to a page it sent. Whatever can't be placed (no page fits,
// offline, signed out) lands in the built-in Quick notes page, so a "Note, …" is never lost or pasted.
// "Add this to …": the server only hears that a window was in front (`here`) and answers "@this";
// the window's link, path or screenshot is worked out here, while the server is asked, and never sent.

type Deps = {
  resolve(req: ResolveRequest): Promise<ResolveResponse>;
  /** What the captured window shows (link, path or screenshot). */
  describe(c: Capture): Promise<Described>;
  /** Stores a screenshot as a page image; returns its vn-image:// src. */
  saveImage(bytes: Uint8Array): Promise<string>;
  pages: { list(): Page[]; get(id: string): Page | undefined; appendLine(id: string, text: string): Page };
  /** The Quick notes page's id, creating the page first if it is gone. */
  quickNotes(): string;
  pagesChanged(): void;
};

export type ListResult = { ok: boolean; message: string };

// No LLM answer to say what the user meant: only the word "this" counts ("that" and "it" are in
// too many ordinary sentences to attach, and maybe screenshot, whatever window was open).
const MEANS_THIS = /\bthis\b/i;

export class ListCommands {
  constructor(private readonly d: Deps) {}

  async add(text: string, capture?: Capture | null): Promise<ListResult> {
    const fallback = this.d.quickNotes();
    // Most recently changed first, so a PC with very many pages still sends the ones in use.
    const pages = this.d.pages.list().slice(0, LIMITS.pages);
    const described = capture ? this.d.describe(capture).catch(() => null) : Promise.resolve(null);
    let r: ResolveResponse;
    try {
      r = await this.d.resolve({
        text: text.slice(0, LIMITS.text),
        pages: pages.map((p) => ({ id: p.id, title: p.title.slice(0, LIMITS.title) })),
        ...(capture ? { here: true as const } : {}),
      });
    } catch (err) {
      return this.save(fallback, [await this.withLine(text, described)], failureText(err), text);
    }
    const items = r.action === 'append' ? r.items : r.action === 'none' && r.items?.length ? r.items : null;
    if (!items) return this.save(fallback, [await this.withLine(text, described)], undefined, text);
    const d = items.includes(THIS_ITEM) ? await described : null;
    const line = d && (await this.line(d));
    const filled = items.map((i) => (i === THIS_ITEM ? (line ?? text) : i));
    const shown = items.length === 1 && d ? d.label : undefined;
    if (r.action === 'append' && pages.some((p) => p.id === r.pageId) && this.d.pages.get(r.pageId)) return this.save(r.pageId, filled, undefined, shown);
    // A page it didn't send (or deleted meanwhile): the whole command, unless "this" was made out.
    return this.save(fallback, r.action === 'none' || d ? filled : [text], undefined, shown);
  }

  /** The spoken text, with the window's line after it when it says "this". */
  private async withLine(text: string, described: Promise<Described | null>): Promise<string> {
    const d = MEANS_THIS.test(text) ? await described : null;
    return d ? `${text} · ${await this.line(d)}` : text;
  }

  private async line(d: Described): Promise<string> {
    const imageSrc = d.image ? await this.d.saveImage(d.image).catch(() => undefined) : undefined;
    return captureLine({ label: d.label, app: d.app, url: d.url, path: d.path, imageSrc });
  }

  private save(pageId: string, items: string[], why?: string, shown?: string): ListResult {
    for (const item of items) this.d.pages.appendLine(pageId, item);
    this.d.pagesChanged();
    const page = this.d.pages.get(pageId);
    const what = items.length === 1 ? (shown ?? items[0]) : `${items.length} items`;
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
