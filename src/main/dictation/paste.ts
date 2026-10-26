export type ClipboardPort<S> = { snapshot(): Promise<S>; restore(s: S): Promise<void>; writeText(text: string): Promise<void> };

export type PasteDeps<S> = {
  clipboard: ClipboardPort<S>;
  modifiersHeld(): boolean;
  sendCtrlV(): void;
  sleep(ms: number): Promise<void>;
  restoreMs?: number;
  modifierWaitMs?: number;
  pollMs?: number;
};

/**
 * Types `text` into the focused app through the clipboard, then puts the user's clipboard back.
 * Waits for the hotkey's modifiers to be released first: Win still held would turn Ctrl+V into Win+V.
 */
export async function pasteText<S>(text: string, d: PasteDeps<S>): Promise<void> {
  const restoreMs = d.restoreMs ?? 500;
  const pollMs = d.pollMs ?? 20;
  const polls = Math.ceil((d.modifierWaitMs ?? 2000) / pollMs);
  const saved = await d.clipboard.snapshot();
  try {
    await d.clipboard.writeText(text);
    for (let i = 0; i < polls && d.modifiersHeld(); i++) await d.sleep(pollMs);
    d.sendCtrlV();
    // The target app reads the clipboard asynchronously; restoring at once could paste the old content.
    await d.sleep(restoreMs);
  } finally {
    await d.clipboard.restore(saved);
  }
}
