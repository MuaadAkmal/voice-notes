"use client";

import { StarIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { useEngine, useStore } from "@/app/providers";
import { ItemMenu } from "@/components/shell/ItemMenu";
import { Button } from "@/components/ui/button";
import { useRoute } from "@/hooks/useRoute";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { renameItem } from "@/lib/actions";
import { taskAt } from "@/lib/task-lines";
import { folderPath } from "@/lib/tree";
import { Markdown } from "./Markdown";
import { PageEditor } from "./PageEditor";
import { TitleField } from "./TitleField";

function PageImage({ name, alt }: { name: string; alt: string }) {
  const { url, missing, failed } = useSignedUrl("image", name);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL in a static export
    return <img src={url} alt={alt} loading="lazy" className="rounded-lg" />;
  }
  return (
    <span className="my-2 block rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      {missing ? "Image is still on your PC" : failed ? "Couldn't load this image" : "Loading image…"}
    </span>
  );
}

/** A text page: breadcrumb, title, then the rendered body, or the markdown editor while editing. */
export function PageView({ id }: { id: string }) {
  const snap = useStore();
  const engine = useEngine();
  const { go } = useRoute();
  // The version the editor's text was seeded from, while editing. Every save from this editor is based
  // on it: the text never sees later pulls, so the server must replay what other devices added since.
  const [base, setBase] = useState<number | null>(null);
  const editing = base !== null;
  const page = snap.pages.get(id)?.data;
  const registerDraft = useCallback(
    (read: () => string | null) =>
      engine.registerDraft(id, () => {
        const body = read();
        return body === null || base === null ? null : { body, base };
      }),
    [engine, id, base],
  );

  if (!page) return <p className="text-muted-foreground">This page was deleted, or isn&apos;t on this account.</p>;
  const path = folderPath(snap, page.folderId);

  return (
    <article>
      <div className="mb-4 flex min-h-8 items-center gap-1 text-sm text-muted-foreground">
        <nav className="flex min-w-0 flex-1 items-center gap-1 truncate">
          {path.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <button type="button" className="truncate hover:text-foreground" onClick={() => go({ kind: "folder", id: f.id })}>
                {f.name}
              </button>
              <span aria-hidden>›</span>
            </span>
          ))}
        </nav>
        {page.starred && <StarIcon className="size-4 fill-current text-amber-500" aria-label="Starred" />}
        <Button variant={editing ? "default" : "ghost"} size="sm" onClick={() => setBase(editing ? null : engine.baseFor(id))}>
          {editing ? "Done" : "Edit"}
        </Button>
        <ItemMenu kind="page" id={id} />
      </div>
      <TitleField value={page.title} onSave={(title) => renameItem(engine, "page", id, title)} />
      <div className="mt-6">
        {editing ? (
          <PageEditor
            initial={page.body}
            registerDraft={registerDraft}
            onSave={(body) => engine.edit({ op: "page.setBody", id, body, at: Date.now() }, { baseVersion: base })}
          />
        ) : page.body.trim() ? (
          <Markdown
            body={page.body}
            onTick={(line, checked) => {
              const task = taskAt(page.body, line);
              if (task) engine.edit({ op: "page.setTask", id, line, lineText: task.lineText, checked, at: Date.now() });
            }}
            imageFor={(name, alt) => <PageImage name={name} alt={alt} />}
          />
        ) : (
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setBase(engine.baseFor(id))}>
            Empty page. Click to write.
          </button>
        )}
      </div>
    </article>
  );
}
