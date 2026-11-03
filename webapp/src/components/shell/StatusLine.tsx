"use client";

import { useSyncStatus } from "@/app/providers";
import type { SyncStatus } from "@/sync/engine";
import { cn } from "@/lib/utils";

const TEXT: Record<SyncStatus, string> = {
  saved: "All changes saved",
  saving: "Saving…",
  offline: "Offline · not saved yet",
  error: "Couldn't save · retrying",
};

export function StatusLine() {
  const status = useSyncStatus();
  return (
    <p role="status" className={cn("text-xs text-muted-foreground", (status === "offline" || status === "error") && "text-amber-700 dark:text-amber-400")}>
      {TEXT[status]}
    </p>
  );
}
