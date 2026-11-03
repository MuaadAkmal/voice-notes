"use client";

import { AudioLinesIcon, FileTextIcon, StarIcon } from "lucide-react";
import { useStore } from "@/app/providers";
import { dragProps } from "@/components/shell/FileTree";
import { ItemMenu } from "@/components/shell/ItemMenu";
import { useRoute } from "@/hooks/useRoute";
import { folderPath, listFor, type Route } from "@/lib/tree";

const TITLES = { inbox: "Inbox", starred: "Starred", all: "All voice notes" } as const;

export const formatDate = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

/** Inbox, Starred, All voice notes, or a folder: rows newest first. */
export function ItemList({ route }: { route: Extract<Route, { kind: "view" | "folder" }> }) {
  const snap = useStore();
  const { go } = useRoute();
  const items = listFor(snap, route);
  const folder = route.kind === "folder" ? snap.folders.get(route.id)?.data : null;
  if (route.kind === "folder" && !folder) return <p className="text-muted-foreground">This folder was deleted.</p>;
  const path = route.kind === "folder" ? folderPath(snap, route.id).slice(0, -1) : [];

  return (
    <div>
      {path.length > 0 && <p className="mb-2 text-sm text-muted-foreground">{path.map((f) => f.name).join(" › ")}</p>}
      <div className="mb-8 flex items-center gap-2">
        <h1 className="text-4xl font-semibold tracking-tight">{folder ? folder.name : TITLES[(route as { view: keyof typeof TITLES }).view]}</h1>
        {folder && <ItemMenu kind="folder" id={folder.id} />}
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground">Nothing here yet</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="group flex items-center gap-3 py-1" {...dragProps(item.kind, item.id)}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-left" onClick={() => go({ kind: item.kind, id: item.id })}>
                {item.kind === "page" ? (
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <AudioLinesIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{item.title || "Untitled"}</span>
                {item.starred && <StarIcon className="size-3.5 shrink-0 fill-current text-amber-500" />}
                <span className="ml-auto shrink-0 text-sm text-muted-foreground">{formatDate(item.updatedAt)}</span>
              </button>
              <ItemMenu kind={item.kind} id={item.id} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
