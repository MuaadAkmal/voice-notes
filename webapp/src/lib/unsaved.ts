// Page text not yet saved when the session ran out (or that the server refused), kept in this tab until
// the account's next sign-in offers it back, with the version each edit started from so restoring it
// keeps what other devices added since. Kept per account: one account's text is never offered to another.
import type { Unsaved } from "@/sync/outbox";

const keyOf = (userId: string) => `vn.unsaved.${userId}`;

/** Adds these bodies to the account's kept ones (a newer text of a page replaces the older). */
export function saveUnsaved(userId: string, bodies: Unsaved): void {
  try {
    if (!Object.keys(bodies).length) return;
    sessionStorage.setItem(keyOf(userId), JSON.stringify({ ...peekUnsaved(userId), ...bodies }));
  } catch {
    // Storage blocked: nothing to offer later.
  }
}

/** The saved bodies (page id → text), once; null when there are none. */
export function takeUnsaved(userId: string): Unsaved | null {
  const bodies = peekUnsaved(userId);
  clearUnsaved(userId);
  return bodies;
}

export function clearUnsaved(userId: string): void {
  try {
    sessionStorage.removeItem(keyOf(userId));
  } catch {
    // Storage blocked: nothing was kept.
  }
}

const isRow = (v: unknown) => v === undefined || (!!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" && typeof (v as { title?: unknown }).title === "string");

/** The saved bodies without clearing them; null when there are none. */
export function peekUnsaved(userId: string): Unsaved | null {
  try {
    const raw = sessionStorage.getItem(keyOf(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    const valid = (v: unknown) =>
      !!v && typeof v === "object" && typeof (v as { body?: unknown }).body === "string" && Number.isSafeInteger((v as { base?: unknown }).base) && isRow((v as { row?: unknown }).row);
    if (!entries.length || !entries.every(([, v]) => valid(v))) return null;
    return parsed as Unsaved;
  } catch {
    return null;
  }
}
