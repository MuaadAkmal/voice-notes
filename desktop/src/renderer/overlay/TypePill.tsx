import { useEffect, useRef } from 'react';
import { LIMITS } from '../../shared/commands/protocol';

type Hover = { onMouseEnter: () => void; onMouseLeave: () => void };
export type TypeCan = { undo: boolean; move: boolean };

/**
 * The idle pill, clicked: one line to type a note, reminder, event or Pixie command, with Undo last
 * and Move last to… under it. Main gives the window focus; Esc or clicking away closes it and the
 * draft stays for next time.
 */
export function TypePill({ draft, setDraft, can, onClose, shell, hover }: { draft: string; setDraft(s: string): void; can: TypeCan; onClose(): void; shell: string; hover: Hover }) {
  const api = window.overlayApi;
  const input = useRef<HTMLInputElement>(null);
  const closed = useRef(false);

  // The window only becomes focusable once main handles typeOpen; focus the box when it does.
  useEffect(() => {
    const focus = () => input.current?.focus();
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);

  const close = (send: () => void) => {
    if (closed.current) return;
    closed.current = true;
    send();
    onClose();
  };
  const btn = 'cursor-pointer rounded-full px-2.5 py-0.5 text-white/70 hover:bg-white/15 hover:text-white disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent';
  return (
    // The shell's rounded-full would win over rounded-2xl and turn the box into a circle.
    <div {...hover} data-morph className={`${shell.replace('rounded-full', 'rounded-2xl')} w-72 flex-col items-stretch gap-1 p-2 text-sm`}>
      <input
        ref={input}
        value={draft}
        maxLength={LIMITS.text}
        placeholder='Type a note, or "remind me…"'
        aria-label="Type a note"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close(() => api.typeCancel());
          if (e.key === 'Enter' && draft.trim()) {
            const text = draft.trim();
            setDraft('');
            close(() => api.typeSubmit(text));
          }
        }}
        onBlur={() => close(() => api.typeCancel())}
        className="rounded-lg bg-white/10 px-2.5 py-1.5 text-white placeholder:text-white/40 outline-none"
      />
      <div className="flex justify-end gap-1 text-xs">
        {/* mousedown, not click: the input's blur would close it first */}
        <button
          disabled={!can.undo}
          onMouseDown={(e) => {
            e.preventDefault();
            if (can.undo) close(() => api.typeUndoLast());
          }}
          className={btn}
        >
          Undo last
        </button>
        <button
          disabled={!can.move}
          onMouseDown={(e) => {
            e.preventDefault();
            if (can.move) close(() => api.typeMoveLast());
          }}
          className={btn}
        >
          Move last to…
        </button>
      </div>
    </div>
  );
}
