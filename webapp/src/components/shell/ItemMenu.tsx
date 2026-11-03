"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { useEngine, useStore } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRoute } from "@/hooks/useRoute";
import { canDelete, deleteItem, moveItem, newFolder, renameItem, toggleStar } from "@/lib/actions";
import type { ItemKind } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { MoveDialog } from "./MoveDialog";
import { ConfirmDialog, NameDialog } from "./PromptDialog";

const NOUN: Record<ItemKind, string> = { note: "voice note", page: "page", folder: "folder" };

/** ⋯ for a note, page or folder: Rename, Star, Move to…, Delete (and New folder inside a folder). */
export function ItemMenu({ kind, id, className }: { kind: ItemKind; id: string; className?: string }) {
  const snap = useStore();
  const engine = useEngine();
  const { route, go } = useRoute();
  const [dialog, setDialog] = useState<"rename" | "move" | "delete" | "subfolder" | null>(null);

  const row = kind === "folder" ? snap.folders.get(id)?.data : kind === "page" ? snap.pages.get(id)?.data : snap.notes.get(id)?.data;
  if (!row) return null;
  const name = "name" in row ? row.name : row.title;
  const starred = "starred" in row ? row.starred : false;
  const parent = "parentId" in row ? row.parentId : "folderId" in row ? row.folderId : null;
  const close = () => setDialog(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-xs" aria-label={`More for ${name}`} className={cn("text-muted-foreground", className)} />}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onClick={() => setDialog("rename")}>Rename</DropdownMenuItem>
          {kind !== "folder" && (
            <DropdownMenuItem onClick={() => toggleStar(engine, snap, kind, id)}>{starred ? "Unstar" : "Star"}</DropdownMenuItem>
          )}
          {kind === "folder" && <DropdownMenuItem onClick={() => setDialog("subfolder")}>New folder inside</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => setDialog("move")}>Move to…</DropdownMenuItem>
          {canDelete(snap, kind, id) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "rename" && (
        <NameDialog open title={`Rename ${NOUN[kind]}`} initial={name} action="Rename" onClose={close} onSave={(v) => renameItem(engine, kind, id, v)} />
      )}
      {dialog === "subfolder" && (
        <NameDialog open title="New folder" initial="" action="Create" onClose={close} onSave={(v) => go({ kind: "folder", id: newFolder(engine, id, v) })} />
      )}
      {dialog === "move" && (
        <MoveDialog open kind={kind} id={id} current={parent} onClose={close} onMove={(folderId) => moveItem(engine, snap, kind, id, folderId)} />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          open
          title={`Delete ${NOUN[kind]}?`}
          body={
            kind === "folder"
              ? `“${name}” will be deleted on all your devices. What's inside moves up a level.`
              : `“${name}” will be deleted on all your devices.`
          }
          action="Delete"
          onClose={close}
          onConfirm={() => {
            if (deleteItem(engine, snap, kind, id) && route.kind === kind && route.id === id) go({ kind: "home" });
          }}
        />
      )}
    </>
  );
}
