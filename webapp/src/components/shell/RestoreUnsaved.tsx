"use client";

import { useState } from "react";
import { useEngine, useStore, useSync } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clearUnsaved, peekUnsaved } from "@/lib/unsaved";

/** After signing in again: offers back page text that wasn't saved when the session ran out. */
export function RestoreUnsaved() {
  const snap = useStore();
  const engine = useEngine();
  const { userId } = useSync();
  const [bodies, setBodies] = useState(() => peekUnsaved(userId));
  if (!bodies || !snap.loaded) return null;
  // A page the account has, or a new one that never reached it (made again on restore).
  const pages = Object.keys(bodies).filter((id) => snap.pages.has(id) || bodies[id].row);
  const done = () => {
    clearUnsaved(userId);
    setBodies(null);
  };
  if (!pages.length) return null; // those pages are gone; nothing to put back
  const title = (id: string) => snap.pages.get(id)?.data.title ?? bodies[id].row!.title;
  return (
    <Dialog open onOpenChange={(o) => !o && done()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Restore unsaved text?</DialogTitle>
          <DialogDescription>These pages weren&apos;t saved: {pages.map((id) => `“${title(id)}”`).join(", ")}.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={done}>
            Discard
          </Button>
          <Button
            onClick={() => {
              const now = Date.now();
              for (const id of pages) {
                const { body, base, row } = bodies[id];
                if (!snap.pages.has(id)) {
                  engine.edit({ op: "page.create", id, row: { ...row!, body, updatedAt: now } });
                  continue;
                }
                // On the base the lost edit started from, so what other devices added since is kept. A new
                // page that did reach the account starts from the version it has there.
                engine.edit({ op: "page.setBody", id, body, at: now }, { baseVersion: row && !base ? engine.baseFor(id) : base });
              }
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
