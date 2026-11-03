"use client";

import { useStore } from "@/app/providers";

export function AppShell() {
  const snap = useStore();
  return (
    <main className="grid min-h-screen place-items-center text-muted-foreground">
      {snap.loaded ? `${snap.pages.size} pages · ${snap.notes.size} voice notes` : "Loading…"}
    </main>
  );
}
