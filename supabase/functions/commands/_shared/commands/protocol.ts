// What the app and the `commands` Edge Function say to each other (voice to lists).

export type ListPage = { id: string; title: string };

/** `text`: the dictation after the wake word. `pages`: every page on the PC, the only places items may go. */
export type ResolveRequest = { text: string; pages: ListPage[] };

export type ResolveResponse =
  | { action: 'append'; pageId: string; items: string[] }
  // items: what was said, when the LLM made that out but no page fits (the app files it in Quick notes)
  | { action: 'none'; reason: 'no-match' | 'unclear'; items?: string[] };

export const LIMITS = { text: 500, pages: 300, title: 200, items: 10, item: 200 } as const;
