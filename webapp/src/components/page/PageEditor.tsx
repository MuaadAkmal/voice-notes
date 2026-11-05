"use client";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useRef, useState } from "react";

const SAVE_DELAY_MS = 1000;

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "1rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { fontFamily: "inherit", lineHeight: "1.75", padding: "0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0" },
  ".cm-scroller": { fontFamily: "inherit" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in oklab, var(--ring) 25%, transparent)" },
});

const extensions = [markdown({ base: markdownLanguage, codeLanguages: languages }), EditorView.lineWrapping, theme];

/**
 * The page's markdown source. Seeded once: text that arrives from another device while you type never
 * replaces yours; the server merges it when this edit is saved. Saves 1 s after typing stops, and at once
 * on Done, on leaving the page, and before the tab closes.
 */
export function PageEditor({
  initial,
  onSave,
  registerDraft,
}: {
  initial: string;
  onSave(body: string): void;
  /** Lets the engine read text still waiting for the save delay (kept if the session ends). */
  registerDraft?(read: () => string | null): () => void;
}) {
  const [seed] = useState(initial);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  });

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) save.current(pending.current);
    pending.current = null;
  };

  useEffect(() => registerDraft?.(() => pending.current), [registerDraft]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current === null) return;
      flush();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      flush();
    };
  }, []);

  return (
    <CodeMirror
      value={seed}
      autoFocus
      // Keep the browser caret: CodeMirror's selection overlay hides it with !important.
      basicSetup={{ drawSelection: false, lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
      extensions={extensions}
      theme="none"
      onChange={(text) => {
        pending.current = text;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
      }}
      className="min-h-[50vh]"
    />
  );
}
