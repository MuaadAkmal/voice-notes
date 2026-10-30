import { useRef, useState } from 'react';
import { cleanIpcError } from '../../../shared/format';
import { useToast } from '../Toast';
import { relative, useReminders, when } from '../useReminders';

const api = window.dashboardApi;
const SHOWN = 5;

/** The next few reminders on this PC; a click opens the Reminders tab, the box adds one ("call mom in 10 min"). */
export function RemindersWidget({ onOpenReminders }: { onOpenReminders: () => void }) {
  const list = useReminders();
  const toast = useToast();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const pending = useRef(false); // one add at a time

  const add = async () => {
    const entry = text.trim();
    if (!entry || pending.current) return;
    pending.current = true;
    setAdding(true);
    try {
      const r = await api.addReminder(entry);
      toast(r.message);
      if (r.ok) setText((cur) => (cur.trim() === entry ? '' : cur));
    } catch (e) {
      toast(cleanIpcError(e)); // the text stays, to fix and try again
    } finally {
      pending.current = false;
      setAdding(false);
    }
  };

  if (!list) return null;
  const next = list.filter((r) => r.status === 'pending').slice(0, SHOWN);

  return (
    <div className="flex flex-col gap-2">
      <input
        aria-label="Add reminder"
        placeholder="Remind me… e.g. call mom in 10 min"
        value={text}
        maxLength={1000}
        readOnly={adding}
        aria-busy={adding}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void add();
          }
        }}
        className={`h-7 w-full shrink-0 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 ${adding ? 'opacity-60' : ''}`}
      />
      {next.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">No reminders coming up</p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-xs">
          {next.map((r) => {
            const due = relative(r);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={onOpenReminders}
                  title="Open Reminders"
                  className="flex w-full flex-col rounded px-1.5 py-1 text-left hover:bg-muted"
                >
                  <span className={`break-words ${due === 'Due' ? 'font-medium' : ''}`}>{r.text}</span>
                  <span className="flex items-center gap-1.5 tabular-nums text-[11px] text-muted-foreground">
                    {due === 'Due' && <span aria-label="Due" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                    {when(r.dueAt)}
                    {due && due !== 'Due' && ` · ${due}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
