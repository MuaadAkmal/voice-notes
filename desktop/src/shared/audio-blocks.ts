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

/**
 * Notes a page owns that have been seen with no page linking them for the grace (10 min across
 * sweeps, so an undo brings a line back in time). `unlinkedSince` carries when each was first seen
 * unlinked from one sweep to the next. A recording whose audio this PC never had is left to the
 * PCs that have it: its page may not have arrived here yet.
 */
export function orphanBlocks(
  notes: readonly { id: string; pageId?: string | null; createdAt: number; status: string }[],
  referenced: ReadonlySet<string>,
  unlinkedSince: ReadonlyMap<string, number>,
  now: number,
): { remove: string[]; unlinkedSince: Map<string, number> } {
  const next = new Map<string, number>();
  const remove: string[] = [];
  for (const n of notes) {
    if (!n.pageId || n.status === 'remote' || referenced.has(n.id)) continue;
    const since = unlinkedSince.get(n.id) ?? now;
    if (now - since > GRACE_MS) remove.push(n.id);
    else next.set(n.id, since);
  }
  return { remove, unlinkedSince: next };
}
