"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "@/lib/tree";

const VIEWS = ["inbox", "starred", "all"] as const;

function parse(params: URLSearchParams): Route {
  for (const kind of ["page", "note", "folder"] as const) {
    const id = params.get(kind);
    if (id) return { kind, id };
  }
  const view = params.get("view");
  return { kind: "view", view: VIEWS.find((v) => v === view) ?? "inbox" };
}

/** The open item, from the query string (`?page=`, `?note=`, `?folder=`, `?view=`); nothing = Inbox. */
export function useRoute(): { route: Route; go(r: Route): void } {
  const params = useSearchParams();
  const router = useRouter();
  return {
    route: parse(new URLSearchParams(params.toString())),
    go: (r: Route) => router.push(r.kind === "view" ? `/app/?view=${r.view}` : `/app/?${r.kind}=${encodeURIComponent(r.id)}`),
  };
}
