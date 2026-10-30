// What the app and the `commands` Edge Function say to each other (voice to lists).

export type ListPage = { id: string; title: string };

/**
 * `text`: the dictation after the wake word. `pages`: every page on the PC, the only places items may go.
 * `here`: a window was in front when the user spoke; what it shows stays on the PC.
 */
export type ResolveRequest = { text: string; pages: ListPage[]; here?: true };

/** The item the LLM answers for "this" (what the user is looking at); the app puts the window's line in its place. */
export const THIS_ITEM = '@this';

export type ResolveResponse =
  | { action: 'append'; pageId: string; items: string[] }
  // items: what was said, when the LLM made that out but no page fits (the app files it in Quick notes)
  | { action: 'none'; reason: 'no-match' | 'unclear'; items?: string[] };

export const LIMITS = { text: 500, pages: 300, title: 200, items: 10, item: 200 } as const;
