"use client";

import { AudioLinesIcon, FolderPlusIcon, HomeIcon, InboxIcon, PlusIcon, SearchIcon, StarIcon } from "lucide-react";
import { useState } from "react";
import { useEngine, useSync } from "@/app/providers";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRoute } from "@/hooks/useRoute";
import { newFolder, newPage } from "@/lib/actions";
import { signOut } from "@/lib/supabase";
import { FileTree, rowClass } from "./FileTree";
import { NameDialog } from "./PromptDialog";
import { StatusLine } from "./StatusLine";

const VIEWS = [
  { view: "starred", label: "Starred", icon: StarIcon },
  { view: "inbox", label: "Inbox", icon: InboxIcon },
  { view: "all", label: "All voice notes", icon: AudioLinesIcon },
] as const;

/** Search, New page, the views, the file tree, New folder, and the account footer. `onOpen` closes the phone sheet. */
export function Sidebar({ onSearch, onOpen }: { onSearch(): void; onOpen(): void }) {
  const { route, go } = useRoute();
  const engine = useEngine();
  const { email, outbox } = useSync();
  const [naming, setNaming] = useState(false);
  const here = route.kind === "folder" ? route.id : null;

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <div className="space-y-0.5 p-3">
        <button type="button" className={rowClass(false)} onClick={onSearch}>
          <SearchIcon className="size-4 opacity-60" />
          <span className="flex-1">Find or start a page</span>
          <kbd className="hidden text-xs text-muted-foreground md:inline">⌘K</kbd>
        </button>
        <button
          type="button"
          className={rowClass(false)}
          onClick={() => {
            go({ kind: "page", id: newPage(engine, here) });
            onOpen();
          }}
        >
          <PlusIcon className="size-4 opacity-60" />
          New page
        </button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="space-y-0.5 px-3 pb-3">
          <button
            type="button"
            className={rowClass(route.kind === "home")}
            onClick={() => {
              go({ kind: "home" });
              onOpen();
            }}
          >
            <HomeIcon className="size-4 opacity-60" />
            Home
          </button>
          {VIEWS.map(({ view, label, icon: Icon }) => (
            <button
              key={view}
              type="button"
              className={rowClass(route.kind === "view" && route.view === view)}
              onClick={() => {
                go({ kind: "view", view });
                onOpen();
              }}
            >
              <Icon className="size-4 opacity-60" />
              {label}
            </button>
          ))}
          <FileTree onOpen={onOpen} />
          <button type="button" className={rowClass(false)} onClick={() => setNaming(true)}>
            <FolderPlusIcon className="size-4 opacity-60" />
            New folder
          </button>
        </nav>
      </ScrollArea>
      <div className="space-y-1 border-t border-sidebar-border px-5 py-4">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground/80">{email}</p>
          <ThemeToggle className="-mr-2 text-muted-foreground" />
        </div>
        <StatusLine />
        <a href="/account/" className="block pt-1 text-xs text-muted-foreground hover:text-foreground">
          Plan and billing
        </a>
        <button
          type="button"
          className="pt-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (outbox.size && !confirm("Some changes aren't saved yet. Sign out anyway?")) return;
            void signOut();
          }}
        >
          Sign out
        </button>
      </div>
      {naming && (
        <NameDialog
          open
          title="New folder"
          initial=""
          action="Create"
          onClose={() => setNaming(false)}
          onSave={(name) => {
            go({ kind: "folder", id: newFolder(engine, here, name) });
            onOpen();
          }}
        />
      )}
    </div>
  );
}
