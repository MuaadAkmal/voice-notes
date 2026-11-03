"use client";

import { useState } from "react";
import { useEngine, useStore } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clearUnsaved, peekUnsaved } from "@/lib/unsaved";

/** After signing in again: offers back page text that wasn't saved when the session ran out. */
export function RestoreUnsaved() {
  const snap = useStore();
  const engine = useEngine();
  const [bodies, setBodies] = useState(peekUnsaved);
  if (!bodies || !snap.loaded) return null;
  const pages = Object.keys(bodies).filter((id) => snap.pages.has(id));
  const done = () => {
    clearUnsaved();
    setBodies(null);
  };
  if (!pages.length) return null; // those pages are gone; nothing to put back
  return (
    <Dialog open onOpenChange={(o) => !o && done()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Restore unsaved text?</DialogTitle>
          <DialogDescription>
            You were signed out before these pages were saved: {pages.map((id) => `“${snap.pages.get(id)!.data.title}”`).join(", ")}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={done}>
            Discard
          </Button>
          <Button
            onClick={() => {
              for (const id of pages) engine.edit({ op: "page.setBody", id, body: bodies[id], at: Date.now() });
              done();
            }}
          >
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
