import { useState } from 'react';
import { AlarmClock, CalendarDays, Check, MoreHorizontal } from 'lucide-react';
import type { Reminder } from '../../shared/channels';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from './Toast';
import { relative, useReminders, when } from './useReminders';

const api = window.dashboardApi;
const INPUT =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

/** Reminders on this PC: say "remind me to … in 10 min" while dictating, or type one here. */
export function RemindersPage() {
  const list = useReminders();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await api.addReminder(text);
      toast(r.message);
      if (r.ok) setDraft('');
    } catch (e) {
      toast(cleanIpcError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!list) return null;
  const upcoming = list.filter((r) => r.status === 'pending');
  const past = list.filter((r) => r.status !== 'pending');

  return (
    <div className="mx-auto max-w-3xl px-10 py-9">
      <h1 className="text-2xl font-semibold tracking-tight">Reminders</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Dictate “Remind me to call mom in 10 minutes”, with or without your wake word. Kept on this PC; also added to
        Google Calendar while it's connected.
      </p>

      <div className="mt-6 flex gap-2">
        <input
          aria-label="New reminder"
          placeholder="Call mom in 10 min, or: pay rent on Friday at 3 pm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          className={`${INPUT} flex-1`}
        />
        <Button onClick={() => void add()} disabled={!draft.trim() || busy}>
          Add
        </Button>
      </div>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">No reminders yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-2xl border bg-card">
            {upcoming.map((r) => (
              <ReminderRow key={r.id} r={r} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Past 7 days</h2>
          <ul className="flex flex-col divide-y rounded-2xl border bg-card">
            {past.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground">
                <span className={`min-w-0 flex-1 truncate ${r.status === 'cancelled' ? 'line-through' : ''}`}>{r.text}</span>
                <span className="shrink-0 text-xs">{when(r.dueAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function ReminderRow({ r }: { r: Reminder }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.text);
  const [at, setAt] = useState(toLocalInput(r.dueAt));
  const run = (p: Promise<unknown>) => p.catch((e) => toast(cleanIpcError(e)));
  const due = relative(r);

  if (editing) {
    const save = () => {
      const dueAt = new Date(at).getTime();
      if (!text.trim() || Number.isNaN(dueAt)) return;
      void run(api.updateReminder(r.id, { text: text.trim(), dueAt })).then(() => setEditing(false));
    };
    return (
      <li className="flex flex-wrap items-center gap-2 px-4 py-3">
        <input aria-label="Reminder text" value={text} onChange={(e) => setText(e.target.value)} className={`${INPUT} min-w-40 flex-1`} />
        <input aria-label="Reminder time" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={INPUT} />
        <Button size="sm" onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <AlarmClock className={`size-4 shrink-0 ${due === 'Due' ? 'text-primary' : 'text-muted-foreground'}`} strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{r.text}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{when(r.dueAt)}</span>
          {due && <span className={due === 'Due' ? 'font-medium text-primary' : ''}>· {due}</span>}
          {r.googleEventId && <CalendarDays aria-label="In Google Calendar" className="size-3.5" strokeWidth={1.8} />}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => void run(api.snoozeReminder(r.id))}>
        Snooze
      </Button>
      <Button size="sm" variant="outline" aria-label="Done" onClick={() => void run(api.doneReminder(r.id))}>
        <Check className="size-4" /> Done
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="More">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Edit</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run(api.cancelReminder(r.id))}>Cancel reminder</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
