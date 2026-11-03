/** Accent- and case-insensitive form, as the desktop's search uses. */
export const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export type SearchHit = { kind: "page" | "note"; id: string; title: string; snippet: string };

type Searchable = {
  pages: Iterable<{ id: string; title: string; body: string }>;
  notes: Iterable<{ id: string; title: string; transcript: string | null; show: string | null }>;
};

const MAX_HITS = 50;

/** A short piece of `text` around the first match. */
function snippet(text: string, at: number): string {
  const start = Math.max(0, at - 30);
  const piece = text.slice(start, start + 90).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + piece;
}

/** Pages and notes matching `query` in their title, then those matching in body, transcript or show. */
export function searchAll(items: Searchable, query: string): SearchHit[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const byTitle: SearchHit[] = [];
  const byText: SearchHit[] = [];
  const consider = (kind: SearchHit["kind"], id: string, title: string, texts: (string | null)[]) => {
    if (normalize(title).includes(q)) return void byTitle.push({ kind, id, title, snippet: "" });
    for (const text of texts) {
      const at = text ? normalize(text).indexOf(q) : -1;
      if (text && at >= 0) return void byText.push({ kind, id, title, snippet: snippet(text, at) });
    }
  };
  for (const p of items.pages) consider("page", p.id, p.title, [p.body]);
  for (const n of items.notes) consider("note", n.id, n.title, [n.transcript, n.show]);
  return [...byTitle, ...byText].slice(0, MAX_HITS);
}
