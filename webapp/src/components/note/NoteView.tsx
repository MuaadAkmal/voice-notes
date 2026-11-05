"use client";

import { PlayIcon, StarIcon } from "lucide-react";
import { useState } from "react";
import { useEngine, useStore } from "@/app/providers";
import { ItemMenu } from "@/components/shell/ItemMenu";
import { TitleField } from "@/components/page/TitleField";
import { Button } from "@/components/ui/button";
import { useRoute } from "@/hooks/useRoute";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { renameItem } from "@/lib/actions";
import { folderPath } from "@/lib/tree";
import { TranscriptField } from "./TranscriptField";

const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Asks for the audio only when Play is pressed: signed URLs are short-lived and most glances don't play. */
function Player({ id }: { id: string }) {
  const [wanted, setWanted] = useState(false);
  const { url, missing, failed, retry } = useSignedUrl("audio", `${id}.webm`, wanted);
  if (!wanted)
    return (
      <Button variant="outline" onClick={() => setWanted(true)}>
        <PlayIcon />
        Play
      </Button>
    );
  if (missing || failed)
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <p>{missing ? "Audio is still on your PC" : "Couldn't load the audio."}</p>
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  if (!url) return <p className="text-sm text-muted-foreground">Loading audio…</p>;
  return <audio controls autoPlay preload="none" src={url} className="w-full" />;
}

/** A voice note: title, where and when it was recorded, the audio, and its transcript. */
export function NoteView({ id }: { id: string }) {
  const snap = useStore();
  const engine = useEngine();
  const { go } = useRoute();
  const note = snap.notes.get(id)?.data;

  if (!note) return <p className="text-muted-foreground">This voice note was deleted, or isn&apos;t on this account.</p>;
  const path = folderPath(snap, note.folderId);
  const meta = [
    note.show,
    new Date(note.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    note.durationMs ? duration(note.durationMs) : null,
  ].filter(Boolean);

  return (
    <article>
      <div className="mb-4 flex min-h-8 items-center gap-1 text-sm text-muted-foreground">
        <nav className="flex min-w-0 flex-1 items-center gap-1 truncate">
          {path.length ? (
            path.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <button type="button" className="truncate hover:text-foreground" onClick={() => go({ kind: "folder", id: f.id })}>
                  {f.name}
                </button>
                <span aria-hidden>›</span>
              </span>
            ))
          ) : (
            <button type="button" className="hover:text-foreground" onClick={() => go({ kind: "view", view: "inbox" })}>
              Inbox ›
            </button>
          )}
        </nav>
        {note.starred && <StarIcon className="size-4 fill-current text-amber-500" aria-label="Starred" />}
        <ItemMenu kind="note" id={id} />
      </div>
      <TitleField value={note.title} placeholder="Voice note" onSave={(title) => renameItem(engine, "note", id, title)} />
      <p className="mt-2 text-sm text-muted-foreground">{meta.join(" · ")}</p>
      <div className="mt-6">
        <Player key={id} id={id} />
      </div>
      <section className="mt-10">
        <TranscriptField
          key={note.transcript ?? "∅"}
          transcript={note.transcript}
          onSave={(transcript) => engine.edit({ op: "note.update", id, fields: { transcript, updatedAt: Date.now() } })}
        />
      </section>
    </article>
  );
}
