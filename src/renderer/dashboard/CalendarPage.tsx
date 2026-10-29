import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { CalendarError, CalendarEvent } from '../../shared/channels';
import { eventPhase } from '../../shared/calendar-format';
import { chipsFor, monthGrid, weekStartFor } from '../../shared/calendar-month';
import { DayEventsDialog, EventDialog } from './EventDialog';
import { NewEventDialog } from './NewEventDialog';
import { useConnectors } from './useConnectors';
import { Button } from '@/components/ui/button';

const api = window.dashboardApi;
const REFRESH_MS = 5 * 60_000;
const CHIPS = 3; // events shown in a cell before "+N more"

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const nextDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
const chipTime = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** The primary Google Calendar as a month grid; events open their details, empty space adds one. */
export function CalendarPage({ onOpenConnectors }: { onOpenConnectors: () => void }) {
  const info = useConnectors();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const weekStart = useMemo(() => weekStartFor(navigator.language), []);
  const grid = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<CalendarError | null>(null);
  const [now, setNow] = useState(Date.now());
  const [newOn, setNewOn] = useState<Date | null>(null);
  const [shown, setShown] = useState<CalendarEvent | null>(null);
  const [dayList, setDayList] = useState<Date | null>(null);
  const loads = useRef(0);
  const connected = info?.state === 'connected';

  const load = useCallback(() => {
    const n = ++loads.current; // an answer for a month already left behind is dropped
    setNow(Date.now());
    api.calendarRange(grid[0].getTime(), nextDay(grid[grid.length - 1]).getTime()).then(
      (r) => {
        if (n !== loads.current) return;
        if ('error' in r) setError(r.error);
        else {
          setEvents(r.events);
          setError(null);
        }
      },
      () => n === loads.current && setError('failed'),
    );
  }, [grid]);

  useEffect(() => {
    if (!connected) return;
    load();
    const every = setInterval(load, REFRESH_MS);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(every);
      window.removeEventListener('focus', load);
    };
  }, [connected, load]);

  if (!info) return null;
  if (!connected)
    return (
      <div className="mx-auto max-w-3xl px-10 py-9">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <div className="mt-6 flex flex-col items-start gap-3 text-sm text-muted-foreground">
          {info.state === 'needs-reconnect' ? 'Google access was removed. Reconnect to see your calendar.' : 'Connect Google Calendar to see it here.'}
          <Button variant="outline" size="sm" onClick={onOpenConnectors}>
            Open Connectors
          </Button>
        </div>
      </div>
    );

  const today = startOfDay(new Date(now)).getTime();
  const weeks = Array.from({ length: grid.length / 7 }, (_, w) => grid.slice(w * 7, w * 7 + 7));
  const shift = (by: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1));

  return (
    <div className="flex h-full min-h-[560px] flex-col px-8 py-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h1>
        <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
          Today
        </Button>
        <div className="flex">
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button size="sm" onClick={() => setNewOn(new Date(Math.max(today, month.getTime())))}>
          <Plus className="h-4 w-4" />
          New event
        </Button>
      </header>

      {error && (
        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          {error === 'offline' ? "Can't reach Google." : error === 'needs-reconnect' ? 'Google access was removed.' : "Couldn't load your calendar."}
          <Button variant="outline" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      <div role="grid" aria-label="Month" className="mt-4 grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] overflow-hidden rounded-lg border border-border">
        <div role="row" className="contents">
          {grid.slice(0, 7).map((d) => (
            <div key={d.getDay()} role="columnheader" className="border-b border-border bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {d.toLocaleDateString(undefined, { weekday: 'short' })}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0].getTime()} role="row" className="contents">
            {week.map((day) => {
              const chips = chipsFor(day, events);
              const inMonth = day.getMonth() === month.getMonth();
              const isToday = day.getTime() === today;
              return (
                <div
                  key={day.getTime()}
                  role="gridcell"
                  aria-label={day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  onClick={() => setNewOn(day)}
                  className={`flex min-h-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-b border-r border-border p-1 hover:bg-muted/30 [&:nth-child(7n)]:border-r-0 ${inMonth ? '' : 'bg-muted/20'}`}
                >
                  <span
                    className={`mb-0.5 grid h-6 w-6 shrink-0 place-items-center self-start rounded-full text-xs tabular-nums ${
                      isToday ? 'bg-primary font-semibold text-primary-foreground' : inMonth ? '' : 'text-muted-foreground/60'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {chips.slice(0, CHIPS).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      title={e.title}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setShown(e);
                      }}
                      className={`flex w-full shrink-0 items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] leading-4 ${
                        e.allDay ? 'bg-primary/15 font-medium text-foreground hover:bg-primary/25' : 'hover:bg-muted'
                      } ${eventPhase(e, now) === 'past' ? 'opacity-60' : ''}`}
                    >
                      {!e.allDay && <span className="shrink-0 tabular-nums text-muted-foreground">{chipTime(e.start)}</span>}
                      <span className="truncate">{e.title}</span>
                    </button>
                  ))}
                  {chips.length > CHIPS && (
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setDayList(day);
                      }}
                      className="shrink-0 self-start rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      +{chips.length - CHIPS} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <NewEventDialog day={newOn} onClose={() => setNewOn(null)} onAdded={load} />
      <EventDialog event={shown} onClose={() => setShown(null)} />
      <DayEventsDialog
        day={dayList}
        events={dayList ? chipsFor(dayList, events) : []}
        onPick={(e) => {
          setDayList(null);
          setShown(e);
        }}
        onClose={() => setDayList(null)}
      />
    </div>
  );
}
