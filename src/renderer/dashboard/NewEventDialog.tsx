import { useEffect, useState } from 'react';
import type { CalendarEvent } from '../../shared/channels';
import { addErrorText, formatAdded } from '../../shared/calendar-format';
import { useToast } from './Toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const api = window.dashboardApi;

const inputClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 [color-scheme:light] dark:[color-scheme:dark]';

const pad = (n: number) => String(n).padStart(2, '0');
const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

/** Today: the next full hour (at the latest 23:00); another day: 09:00. The end is an hour later, within the day. */
function defaultTimes(day: Date): { start: string; end: string } {
  const now = new Date();
  const isToday = day.toDateString() === now.toDateString();
  const start = isToday ? Math.min((now.getHours() + 1) * 60, 23 * 60) : 9 * 60;
  return { start: hhmm(start), end: hhmm(Math.min(start + 60, 23 * 60 + 59)) };
}

type Props = {
  /** The day the dialog opens on; null when closed. */
  day: Date | null;
  onClose: () => void;
  onAdded: (e: CalendarEvent) => void;
};

/** Adds an event to the primary Google Calendar: title, date, and start–end or all day. */
export function NewEventDialog({ day, onClose, onAdded }: Props) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [busy, setBusy] = useState(false);

  // Each opening starts fresh on the day it was opened for.
  useEffect(() => {
    if (!day) return;
    const t = defaultTimes(day);
    setTitle('');
    setAllDay(false);
    setDate(toDateValue(day));
    setStart(t.start);
    setEnd(t.end);
    setBusy(false);
  }, [day]);

  const [y, m, d] = date.split('-').map(Number);
  const validDate = !!y && !!m && !!d;
  // Minutes past the date's midnight; an all-day event runs to the next midnight (Google's end is exclusive).
  const at = (mins: number) => (validDate ? new Date(y, m - 1, d, 0, mins).getTime() : 0);
  const startMs = at(allDay ? 0 : minutes(start));
  const endMs = at(allDay ? 24 * 60 : minutes(end));
  const valid = title.trim().length > 0 && title.trim().length <= 1000 && validDate && (allDay || (!!start && !!end && endMs > startMs));

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const r = await api.createEvent({ title: title.trim(), allDay, start: startMs, end: endMs }).catch(() => ({ error: 'failed' as const }));
    if ('error' in r) {
      toast(addErrorText(r.error));
      setBusy(false);
      return;
    }
    toast(`Added: ${formatAdded(r.event)}`, r.event.link ? { label: 'Open', onClick: () => api.openExternal(r.event.link) } : undefined);
    onAdded(r.event);
    onClose();
  };

  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">New event</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm">
            Title
            <input className={inputClass} value={title} maxLength={1000} autoFocus onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            All day
          </label>
          <div className="grid grid-cols-[1fr_auto_auto] gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              Date
              <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            {!allDay && (
              <>
                <label className="flex flex-col gap-1.5 text-sm">
                  Start
                  <input type="time" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  End
                  <input type="time" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
                </label>
              </>
            )}
          </div>
          {!allDay && validDate && start && end && endMs <= startMs && (
            <p className="text-xs text-destructive">The end has to be after the start.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
