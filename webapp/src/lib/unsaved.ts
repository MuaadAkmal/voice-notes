// Page text not yet saved when the session ran out, kept in this tab until the next sign-in offers it back,
// with the version each edit started from so restoring it keeps what other devices added since.
import type { Unsaved } from "@/sync/outbox";

const KEY = "vn.unsaved";

export function saveUnsaved(bodies: Unsaved): void {
  try {
    if (Object.keys(bodies).length) sessionStorage.setItem(KEY, JSON.stringify(bodies));
  } catch {
    // Storage blocked: nothing to offer later.
  }
}

/** The saved bodies (page id → text), once; null when there are none. */
export function takeUnsaved(): Unsaved | null {
  const bodies = peekUnsaved();
  clearUnsaved();
  return bodies;
}

export function clearUnsaved(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/** The saved bodies without clearing them; null when there are none. */
export function peekUnsaved(): Unsaved | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    const valid = (v: unknown) => !!v && typeof v === "object" && typeof (v as { body?: unknown }).body === "string" && Number.isSafeInteger((v as { base?: unknown }).base);
    if (!entries.length || !entries.every(([, v]) => valid(v))) return null;
    return parsed as Unsaved;
  } catch {
    return null;
  }
}
