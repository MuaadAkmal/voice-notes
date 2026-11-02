/**
 * The user id of the session supabase-js stored, read straight from its storage: no network and no expiry
 * check, so a PC that starts offline with an expired token still opens its account's profile.
 */
export function sessionUserId(storage: { getItem(key: string): string | null }, supabaseUrl: string): string | null {
  // supabase-js's default storage key: sb-<project ref>-auth-token.
  const key = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  try {
    const raw = storage.getItem(key);
    const id: unknown = raw ? (JSON.parse(raw) as { user?: { id?: unknown } })?.user?.id : null;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}
