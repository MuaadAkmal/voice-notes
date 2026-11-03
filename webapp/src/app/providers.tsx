"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { SUPABASE_PUBLISHABLE_KEY, SYNC_URL } from "@/lib/config";
import { deviceName } from "@/lib/device";
import { signOut, supabase } from "@/lib/supabase";
import { saveUnsaved } from "@/lib/unsaved";
import { SyncClient } from "@/sync/client";
import { SyncEngine, type SyncStatus } from "@/sync/engine";
import { Outbox } from "@/sync/outbox";
import { WebStore, type Snapshot } from "@/sync/store";

type Sync = { store: WebStore; engine: SyncEngine; outbox: Outbox; client: SyncClient; email: string | null };

const SyncContext = createContext<Sync | null>(null);

/** This browser's sync id, made once. */
function clientId(): string {
  try {
    let id = localStorage.getItem("vn.clientId");
    if (!id) localStorage.setItem("vn.clientId", (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function makeSync(email: string | null): Sync {
  const auth = supabase().auth;
  const client = new SyncClient({
    base: SYNC_URL,
    apikey: SUPABASE_PUBLISHABLE_KEY,
    token: async () => (await auth.getSession()).data.session?.access_token ?? null,
  });
  const store = new WebStore();
  const outbox = new Outbox();
  const engine = new SyncEngine({
    client,
    store,
    outbox,
    clientId: clientId(),
    deviceName: deviceName(navigator.userAgent),
    refresh: async () => !(await auth.refreshSession()).error,
    onSignedOut: (unsaved) => {
      saveUnsaved(unsaved);
      void signOut();
    },
    onRejected: () => toast.error("A change couldn't be saved"),
  });
  return { store, engine, outbox, client, email };
}

/** Sync for the signed-in account: the engine, the account's Realtime pings, and a warning before losing edits. */
export function SyncProvider({ userId, email, children }: { userId: string; email: string | null; children: ReactNode }) {
  const [sync] = useState(() => makeSync(email));

  useEffect(() => {
    const { engine, outbox } = sync;
    engine.start();
    const sb = supabase();
    let channel: ReturnType<typeof sb.channel> | null = null;
    void sb.auth.getSession().then(async ({ data }) => {
      if (data.session) await sb.realtime.setAuth(data.session.access_token);
      channel = sb
        .channel(`sync:${userId}`, { config: { private: true } })
        .on("broadcast", { event: "changed" }, (msg) => engine.ping(String(msg.payload?.from ?? "")))
        .subscribe();
    });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (outbox.size > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      engine.stop();
      if (channel) void sb.removeChannel(channel);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [sync, userId]);

  return <SyncContext.Provider value={sync}>{children}</SyncContext.Provider>;
}

export function useSync(): Sync {
  const sync = useContext(SyncContext);
  if (!sync) throw new Error("useSync outside SyncProvider");
  return sync;
}

export const useEngine = () => useSync().engine;

export function useStore(): Snapshot {
  const { store } = useSync();
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useSync();
  return useSyncExternalStore(
    (fn) => engine.onStatus(fn),
    () => engine.status,
    () => engine.status,
  );
}
