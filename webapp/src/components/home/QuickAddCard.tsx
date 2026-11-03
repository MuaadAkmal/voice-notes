"use client";

import { useState } from "react";
import { useEngine, useStore } from "@/app/providers";
import { Input } from "@/components/ui/input";
import { localDay, todayEntries } from "@/lib/learn-log";
import { CardHeader } from "./CardHeader";

const MAX_ENTRY = 500;

/** A quick-add box: each entry goes under today's heading of its page, as on the PC; today's entries below. */
export function QuickAddCard({ pageId }: { pageId: string }) {
  const snap = useStore();
  const engine = useEngine();
  const [text, setText] = useState("");
  const page = snap.pages.get(pageId)?.data;
  if (!page) return null;
  const entries = todayEntries(page.body, new Date());

  const submit = () => {
    const entry = text.trim();
    if (!entry) return;
    const now = new Date();
    engine.edit({ op: "page.append", id: pageId, text: entry, day: localDay(now), at: now.getTime() });
    setText("");
  };

  return (
    <>
      <CardHeader pageId={pageId} title={page.title} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
        <Input
          aria-label={`Add to ${page.title || "Untitled"}`}
          placeholder="Type and press Enter"
          value={text}
          maxLength={MAX_ENTRY}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Today</p>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground/70">Nothing yet today</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {entries.map((entry, i) => (
                <li key={i} className="break-words">
                  {entry}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
