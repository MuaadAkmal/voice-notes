"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The transcript as text, with Edit to fix it. null = not transcribed yet; '' = transcribed, no speech. */
export function TranscriptField({ transcript, onSave }: { transcript: string | null; onSave(text: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null)
    return (
      <div className="space-y-3">
        <Textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-48 text-base leading-7" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (draft !== (transcript ?? "")) onSave(draft);
              setDraft(null);
            }}
          >
            Save
          </Button>
        </div>
      </div>
    );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Transcript</h2>
        {transcript !== null && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(transcript)}>
            Edit
          </Button>
        )}
      </div>
      {transcript === null ? (
        <p className="text-muted-foreground">Not transcribed yet. Transcribe it on your PC.</p>
      ) : transcript === "" ? (
        <p className="text-muted-foreground">No speech</p>
      ) : (
        <p className="whitespace-pre-wrap leading-7">{transcript}</p>
      )}
    </div>
  );
}
