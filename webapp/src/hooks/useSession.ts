"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type SessionState = { state: "loading" | "signed-out" | "signed-in"; email: string | null; userId: string | null };

export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>({ state: "loading", email: null, userId: null });
  useEffect(() => {
    const auth = supabase().auth;
    const set = (user: { id: string; email?: string } | null | undefined) =>
      setSession(user ? { state: "signed-in", email: user.email ?? null, userId: user.id } : { state: "signed-out", email: null, userId: null });
    // getSession also finishes a sign-in that just came back with ?code=.
    void auth.getSession().then(({ data }) => set(data.session?.user));
    const { data } = auth.onAuthStateChange((_event, s) => set(s?.user));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}
