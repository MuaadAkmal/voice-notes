"use client";

import { AudioLinesIcon, FileTextIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useEngine, useStore } from "@/app/providers";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useRoute } from "@/hooks/useRoute";
import { newPage, renameItem } from "@/lib/actions";
import { normalize, searchAll } from "@/lib/search";

/** ⌘K: find a page or voice note by title, text or transcript, or start a page with that name. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const snap = useStore();
  const engine = useEngine();
  const { route, go } = useRoute();
  const [query, setQuery] = useState("");
  const hits = searchAll(
    { pages: [...snap.pages.values()].map((p) => p.data), notes: [...snap.notes.values()].map((n) => n.data) },
    query,
  );
  const exact = hits.some((h) => normalize(h.title) === normalize(query.trim()));
  const close = () => {
    onOpenChange(false);
    setQuery("");
  };

  return (
    <CommandDialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())} title="Find or start a page" description="Search your pages and voice notes">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Find or start a page…" value={query} onValueChange={setQuery} />
        <CommandList>
          {query.trim() && !hits.length && <CommandEmpty>Nothing found.</CommandEmpty>}
          {hits.length > 0 && (
            <CommandGroup heading="Results">
              {hits.map((h) => (
                <CommandItem
                  key={`${h.kind}:${h.id}`}
                  value={`${h.kind}:${h.id}`}
                  onSelect={() => {
                    go({ kind: h.kind, id: h.id });
                    close();
                  }}
                >
                  {h.kind === "page" ? <FileTextIcon /> : <AudioLinesIcon />}
                  <div className="min-w-0">
                    <div className="truncate">{h.title || "Untitled"}</div>
                    {h.snippet && <div className="truncate text-xs text-muted-foreground">{h.snippet}</div>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {query.trim() && !exact && (
            <CommandGroup heading="New">
              <CommandItem
                value="create"
                onSelect={() => {
                  const id = newPage(engine, route.kind === "folder" ? route.id : null);
                  renameItem(engine, "page", id, query);
                  go({ kind: "page", id });
                  close();
                }}
              >
                <PlusIcon />
                Create page “{query.trim()}”
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
