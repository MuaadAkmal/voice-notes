"use client";

import { ChevronRightIcon, FileTextIcon, FolderIcon } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";
import { useEngine, useStore } from "@/app/providers";
import { useRoute } from "@/hooks/useRoute";
import { moveItem } from "@/lib/actions";
import { buildTree, type FolderNode, type ItemKind } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { ItemMenu } from "./ItemMenu";

import { DRAG_TYPE, dropOnto, isOurs } from "@/lib/drop";

export function dragProps(kind: ItemKind, id: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind, id }));
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

/** Drop handlers that move a dragged note, page or folder into `folderId` (null = no folder). */
export function useDropInto(folderId: string | null) {
  const snap = useStore();
  const engine = useEngine();
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!isOurs(e)) return;
        e.preventDefault();
        e.stopPropagation(); // only the innermost target lights up
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false);
        dropOnto(e, folderId, (kind, id, to) => moveItem(engine, snap, kind, id, to));
      },
    },
  };
}

export const rowClass = (active: boolean) =>
  cn(
    "group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
    active && "bg-sidebar-accent font-medium text-sidebar-foreground",
  );

function PageRow({ id, title, depth, onOpen }: { id: string; title: string; depth: number; onOpen(): void }) {
  const { route, go } = useRoute();
  const active = route.kind === "page" && route.id === id;
  return (
    <div className={rowClass(active)} style={{ paddingLeft: 8 + depth * 14 }} {...dragProps("page", id)}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => {
          go({ kind: "page", id });
          onOpen();
        }}
      >
        <FileTextIcon className="size-4 shrink-0 opacity-60" />
        <span className="truncate">{title || "Untitled"}</span>
      </button>
      <ItemMenu kind="page" id={id} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100" />
    </div>
  );
}

function FolderRow({ folder, depth, onOpen }: { folder: FolderNode; depth: number; onOpen(): void }) {
  const { route, go } = useRoute();
  const [open, setOpen] = useState(false);
  const drop = useDropInto(folder.id);
  const active = route.kind === "folder" && route.id === folder.id;
  return (
    <div>
      <div
        className={cn(rowClass(active), drop.over && "ring-2 ring-ring/50")}
        style={{ paddingLeft: 8 + depth * 14 }}
        {...dragProps("folder", folder.id)}
        {...drop.props}
      >
        <button type="button" aria-label={open ? "Collapse" : "Expand"} className="-ml-1 rounded p-0.5 hover:bg-sidebar-border" onClick={() => setOpen(!open)}>
          <ChevronRightIcon className={cn("size-3.5 opacity-60 transition-transform", open && "rotate-90")} />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => {
            setOpen(true);
            go({ kind: "folder", id: folder.id });
            onOpen();
          }}
        >
          <FolderIcon className="size-4 shrink-0 opacity-60" />
          <span className="truncate">{folder.name}</span>
        </button>
        <ItemMenu kind="folder" id={folder.id} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100" />
      </div>
      {open && <Branch folders={folder.folders} pages={folder.pages} depth={depth + 1} onOpen={onOpen} />}
    </div>
  );
}

function Branch({ folders, pages, depth, onOpen }: { folders: FolderNode[]; pages: { id: string; title: string }[]; depth: number; onOpen(): void }): ReactNode {
  return (
    <>
      {folders.map((f) => (
        <FolderRow key={f.id} folder={f} depth={depth} onOpen={onOpen} />
      ))}
      {pages.map((p) => (
        <PageRow key={p.id} id={p.id} title={p.title} depth={depth} onOpen={onOpen} />
      ))}
    </>
  );
}

/** Folders with their pages, unfiled pages at the root, like the desktop sidebar. */
export function FileTree({ onOpen }: { onOpen(): void }) {
  const snap = useStore();
  const tree = buildTree(snap);
  const root = useDropInto(null);
  return (
    <div {...root.props} className={cn("rounded-md", root.over && "ring-2 ring-ring/50")}>
      <div className="px-2 pb-1 pt-4 text-xs font-medium text-muted-foreground">Files</div>
      <Branch folders={tree.folders} pages={tree.pages} depth={0} onOpen={onOpen} />
      {!tree.folders.length && !tree.pages.length && <p className="px-2 py-1 text-sm text-muted-foreground">No pages yet</p>}
    </div>
  );
}
