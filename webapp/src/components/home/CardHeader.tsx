"use client";

import { useRoute } from "@/hooks/useRoute";

/** A card's title, which opens its page. */
export function CardHeader({ pageId, title }: { pageId: string; title: string }) {
  const { go } = useRoute();
  return (
    <button
      type="button"
      onClick={() => go({ kind: "page", id: pageId })}
      className="truncate px-4 pt-3 pb-2 text-left text-sm font-medium hover:underline hover:underline-offset-4"
    >
      {title || "Untitled"}
    </button>
  );
}
