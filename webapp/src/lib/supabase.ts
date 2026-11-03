import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

/** The one browser client: Google sign-in (PKCE), the session in this site's storage, Realtime pings. */
export function supabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export function signInWithGoogle(): Promise<unknown> {
  return supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/app/`, queryParams: { prompt: "select_account" } },
  });
}

export function signOut(): Promise<unknown> {
  return supabase().auth.signOut({ scope: "local" });
}
