"use client";

import { useEngine, useStore } from "@/app/providers";
import { Markdown } from "@/components/page/Markdown";
import { PageImage } from "@/components/page/PageView";
import { taskAt } from "@/lib/task-lines";
import { CardHeader } from "./CardHeader";

/** A pinned page, rendered; its checkboxes tick one line (never a whole-body save, which could undo a PC's quick-add). */
export function PageCard({ pageId }: { pageId: string }) {
  const snap = useStore();
  const engine = useEngine();
  const page = snap.pages.get(pageId)?.data;
  if (!page) return null;
  return (
    <>
      <CardHeader pageId={pageId} title={page.title} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 text-sm">
        {page.body.trim() ? (
          <Markdown
            body={page.body}
            onTick={(line, checked) => {
              const task = taskAt(page.body, line);
              if (task) engine.edit({ op: "page.setTask", id: pageId, line, lineText: task.lineText, checked, at: Date.now() });
            }}
            imageFor={(name, alt) => <PageImage name={name} alt={alt} />}
          />
        ) : (
          <p className="text-muted-foreground">Empty page</p>
        )}
      </div>
    </>
  );
}
