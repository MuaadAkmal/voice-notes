"use client";

import { useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { signInWithGoogle } from "@/lib/supabase";

export function SignIn() {
  const [busy, setBusy] = useState(false);
  return (
    <main className="relative grid min-h-screen place-items-center px-4">
      <ThemeToggle className="absolute right-4 top-4 text-muted-foreground" />
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Voice Notes</h1>
        <p className="mt-2 text-sm text-muted-foreground">Same account as the desktop app.</p>
        <Button
          className="mt-6 w-full"
          size="lg"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signInWithGoogle().catch(() => setBusy(false));
          }}
        >
          {busy ? "Opening Google…" : "Sign in with Google"}
        </Button>
      </div>
    </main>
  );
}
