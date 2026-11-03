// Page text not yet saved when the session ran out, kept in this tab until the next sign-in offers it back.
const KEY = "vn.unsaved";

export function saveUnsaved(bodies: Record<string, string>): void {
  try {
    if (Object.keys(bodies).length) sessionStorage.setItem(KEY, JSON.stringify(bodies));
  } catch {
    // Storage blocked: nothing to offer later.
  }
}

/** The saved bodies (page id → text), once; null when there are none. */
export function takeUnsaved(): Record<string, string> | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    if (!entries.length || entries.some(([, v]) => typeof v !== "string")) return null;
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}
