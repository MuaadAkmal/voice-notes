"use client";

import { PanelLeftIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sidebar } from "./Sidebar";

const CLOSE_DELAY_MS = 300;
// While one of these is open (a ⋯ menu, rename, move…), the pointer is over it, not the sidebar.
const BUSY = '[data-slot="dropdown-menu-content"], [data-slot="dialog-content"]';

type Mode = "closed" | "hover" | "click";

/**
 * The desktop sidebar, hidden until wanted: it slides out when the pointer reaches the left edge (or
 * a drag does, to drop into a folder) and closes once the pointer leaves; the button opens it until
 * you click outside, press Esc or open something.
 */
export function PeekSidebar({ onSearch }: { onSearch(): void }) {
  const [mode, setMode] = useState<Mode>("closed");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = mode !== "closed";

  const cancelClose = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (how: Exclude<Mode, "closed">) => {
    cancelClose();
    setMode((m) => (m === "click" ? m : how));
  };
  const close = () => {
    cancelClose();
    setMode("closed");
  };
  const leave = () => {
    if (mode !== "hover") return;
    cancelClose();
    timer.current = setTimeout(function check() {
      if (document.querySelector(BUSY)) return void (timer.current = setTimeout(check, CLOSE_DELAY_MS));
      setMode("closed");
    }, CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(BUSY)) setMode("closed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => cancelClose, []);

  return (
    <div className="hidden md:block">
      {/* The left edge: reaching it opens the sidebar. */}
      <div aria-hidden className="fixed inset-y-0 left-0 z-30 w-2" onMouseEnter={() => show("hover")} onDragEnter={() => show("hover")} />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open sidebar"
        aria-expanded={open}
        className={cn("fixed left-3 top-3 z-20 text-muted-foreground transition-opacity", open && "pointer-events-none opacity-0")}
        onClick={() => show("click")}
        onMouseEnter={() => show("hover")}
      >
        <PanelLeftIcon />
      </Button>
      {mode === "click" && <div aria-hidden className="fixed inset-0 z-30" onClick={close} />}
      <aside
        aria-label="Sidebar"
        inert={!open}
        onMouseEnter={cancelClose}
        onMouseLeave={leave}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leave();
        }}
        onDrop={leave}
        className={cn(
          "fixed inset-y-2 left-2 z-40 flex w-[280px] overflow-hidden rounded-xl border border-sidebar-border shadow-xl transition-[translate,opacity] duration-200 ease-out",
          open ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-[calc(100%+1rem)] opacity-0",
        )}
      >
        <Sidebar
          onSearch={() => {
            close();
            onSearch();
          }}
          onOpen={close}
        />
      </aside>
    </div>
  );
}
