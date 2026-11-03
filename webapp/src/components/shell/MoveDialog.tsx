"use client";

import { FolderIcon, InboxIcon } from "lucide-react";
import { useStore } from "@/app/providers";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { buildTree, isInside, type FolderNode, type ItemKind } from "@/lib/tree";
import { cn } from "@/lib/utils";

/** Picks a folder to move an item into (touch screens can't drag). */
export function MoveDialog({
  open,
  kind,
  id,
  current,
  onClose,
  onMove,
}: {
  open: boolean;
  kind: ItemKind;
  id: string;
  current: string | null;
  onClose(): void;
  onMove(folderId: string | null): void;
}) {
  const snap = useStore();
  const tree = buildTree(snap);
  const pick = (folderId: string | null) => {
    onMove(folderId);
    onClose();
  };
  const row = (folder: FolderNode, depth: number): React.ReactNode => {
    const blocked = kind === "folder" && isInside(snap, folder.id, id);
    return (
      <div key={folder.id}>
        <button
          type="button"
          disabled={blocked || folder.id === current}
          onClick={() => pick(folder.id)}
          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40")}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <FolderIcon className="size-4 text-muted-foreground" />
          <span className="truncate">{folder.name}</span>
        </button>
        {folder.folders.map((f) => row(f, depth + 1))}
      </div>
    );
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move to…</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-80">
          <button
            type="button"
            disabled={current === null}
            onClick={() => pick(null)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40"
          >
            <InboxIcon className="size-4 text-muted-foreground" />
            No folder
          </button>
          {tree.folders.map((f) => row(f, 0))}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
