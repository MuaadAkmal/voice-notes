"use client";

import { MenuIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/app/providers";
import { ItemList } from "@/components/ItemList";
import { PageView } from "@/components/page/PageView";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useRoute } from "@/hooks/useRoute";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";

function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-label="Loading">
      <div className="h-10 w-2/3 rounded-md bg-muted" />
      <div className="h-4 w-full rounded bg-muted" />
      <div className="h-4 w-5/6 rounded bg-muted" />
      <div className="h-4 w-4/6 rounded bg-muted" />
    </div>
  );
}

/** Sidebar (a sheet on phones) beside a calm centred column with the open page, note or list. */
export function AppShell() {
  const snap = useStore();
  const { route } = useRoute();
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openSearch = () => {
    setSheet(false);
    setPalette(true);
  };

  let content: React.ReactNode;
  if (!snap.loaded) content = <Loading />;
  else if (route.kind === "page") content = <PageView key={route.id} id={route.id} />;
  else if (route.kind === "note") content = <p className="text-muted-foreground">Note {route.id}</p>;
  else content = <ItemList key={route.kind === "folder" ? route.id : route.view} route={route} />;

  return (
    <div className="flex h-dvh">
      <aside className="hidden w-[280px] shrink-0 border-r border-sidebar-border md:flex">
        <Sidebar onSearch={openSearch} onOpen={() => {}} />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex h-12 items-center border-b bg-background/90 px-2 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon" aria-label="Open menu" onClick={() => setSheet(true)}>
            <MenuIcon />
          </Button>
          <span className="ml-1 text-sm font-medium">Voice Notes</span>
        </header>
        <main className="mx-auto w-full max-w-[680px] px-4 py-8 md:px-6 md:py-16">{content}</main>
      </div>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="left" className="w-[85vw] max-w-[300px] p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Sidebar onSearch={openSearch} onOpen={() => setSheet(false)} />
        </SheetContent>
      </Sheet>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}
