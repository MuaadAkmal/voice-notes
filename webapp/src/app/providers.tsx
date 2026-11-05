"use client";

import { isAuthApiError } from "@supabase/supabase-js";
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

type Sync = { store: WebStore; engine: SyncEngine; outbox: Outbox; client: SyncClient; userId: string; email: string | null };

const SyncContext = createContext<Sync | null>(null);

/**
 * This tab's sync id, new on every load. The server tells devices apart by it: two tabs sharing one
 * would overwrite each other's page edits without a conflict copy, and ignore each other's pings.
 */
const clientId = () => crypto.randomUUID();

/** 'signed-out' only when the auth server says the session is over; a network or server failure is 'offline'. */
async function refresh(): Promise<"ok" | "signed-out" | "offline"> {
  try {
    const { error } = await supabase().auth.refreshSession();
    if (!error) return "ok";
    return isAuthApiError(error) && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429 ? "signed-out" : "offline";
  } catch {
    return "offline";
  }
}

function makeSync(userId: string, email: string | null): Sync {
  const auth = supabase().auth;
  // Only this account's token: after a switch to another account in this tab, this sync is signed out
  // instead of sending its changes with the new account's token.
  const session = async () => {
    const s = (await auth.getSession()).data.session;
    return s?.user.id === userId ? s : null;
  };
  const client = new SyncClient({
    base: SYNC_URL,
    apikey: SUPABASE_PUBLISHABLE_KEY,
    token: async () => (await session())?.access_token ?? null,
  });
  const store = new WebStore();
  const outbox = new Outbox();
  const engine = new SyncEngine({
    client,
    store,
    outbox,
    clientId: clientId(),
    deviceName: deviceName(navigator.userAgent),
    refresh,
    onSignedOut: (unsaved) => {
      saveUnsaved(userId, unsaved);
      // Another account signed in meanwhile: leave its session alone.
      void auth.getSession().then(({ data }) => {
        if (!data.session || data.session.user.id === userId) void signOut();
      });
    },
    onRejected: (_message, lost) => {
      saveUnsaved(userId, lost);
      toast.error(Object.keys(lost).length ? "A change couldn't be saved. Its text is kept: reload to restore it." : "A change couldn't be saved");
    },
    onTooLarge: () => toast.error("A page is too long to save. Shorten it and it will sync; until then it stays in this tab."),
  });
  return { store, engine, outbox, client, userId, email };
}

/** Sync for the signed-in account: the engine, the account's Realtime pings, and a warning before losing edits. */
export function SyncProvider({ userId, email, children }: { userId: string; email: string | null; children: ReactNode }) {
  const [sync] = useState(() => makeSync(userId, email));

  useEffect(() => {
    const { engine } = sync;
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
      if (Object.keys(engine.unsaved()).length || sync.outbox.size > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      // Torn down with text unsaved (signed out in another tab): keep it for the next sign-in.
      const unsaved = engine.unsaved();
      if (Object.keys(unsaved).length) saveUnsaved(userId, unsaved);
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
