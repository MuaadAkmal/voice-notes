// Voice blocks in pages: a page links an ordinary voice note it owns with a line of its own,
// `[🎙 Voice note](note://<id>)`, which the editor shows as a player. Other apps see a link.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const AUDIO_LINE = new RegExp(`^\\s*\\[🎙[^\\]\\n]*\\]\\(note://(${UUID})\\)\\s*$`);
const NOTE_LINK = new RegExp(`\\]\\(note://(${UUID})\\)`, 'g');
const GRACE_MS = 10 * 60_000;

export const audioLine = (id: string): string => `[🎙 Voice note](note://${id})`;

/** The note a block line plays, or null for any other line. */
export function audioNoteId(line: string): string | null {
  return AUDIO_LINE.exec(line)?.[1] ?? null;
}

/** The text before the cursor ends with `/audio`, as a word of its own. */
export function slashAudio(lineText: string, col: number): boolean {
  return /(^|\s)\/audio$/.test(lineText.slice(0, col));
}

/** Every note linked from these page bodies. */
export function referencedNotes(bodies: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const body of bodies) for (const m of body.matchAll(NOTE_LINK)) ids.add(m[1]);
  return ids;
}

/** Notes a page owns that no page links to any more, once past the grace (an undo can bring a line back). */
export function orphanBlocks(
  notes: readonly { id: string; pageId: string | null; createdAt: number }[],
  referenced: ReadonlySet<string>,
  now: number,
): string[] {
  return notes.filter((n) => n.pageId && !referenced.has(n.id) && now - n.createdAt > GRACE_MS).map((n) => n.id);
}
