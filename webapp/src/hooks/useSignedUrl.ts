"use client";

import type { FileKind } from "@wire/sync/protocol";
import { useEffect, useState } from "react";
import { useSync } from "@/app/providers";
import type { SyncClient } from "@/sync/client";

// Signed URLs live 120 s on the server; reuse one for 60 s.
const FRESH_MS = 60_000;
const requests = new Map<string, { at: number; url: Promise<string | null> }>();

/** The file's signed URL, or null while it is only on a PC; one request per file at a time. */
function signedUrl(client: Pick<SyncClient, "download">, kind: FileKind, name: string): Promise<string | null> {
  const key = `${kind}/${name}`;
  const hit = requests.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.url;
  const url = client.download(kind, name).then((res) => (res.status === "ok" ? res.url : null));
  requests.set(key, { at: Date.now(), url });
  url.catch(() => requests.delete(key));
  return url;
}

type State = { url: string | null; missing: boolean; failed: boolean };
const NONE: State = { url: null, missing: false, failed: false };

/** A short-lived URL for an account file (audio or a page image), once `enabled`. `missing`: still only on a PC. */
export function useSignedUrl(kind: FileKind, name: string, enabled = true): State {
  const { client } = useSync();
  const key = `${kind}/${name}`;
  const [state, setState] = useState<State & { key: string }>({ ...NONE, key: "" });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    signedUrl(client, kind, name).then(
      (url) => live && setState({ key, url, missing: url === null, failed: false }),
      () => live && setState({ key, url: null, missing: false, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [client, kind, name, key, enabled]);

  return state.key === key ? state : NONE;
}
