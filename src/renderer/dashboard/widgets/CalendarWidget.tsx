import { useCallback, useEffect, useRef, useState } from 'react';
import type { TodayResult } from '../../../shared/channels';
import { addErrorText, eventPhase, formatAdded, formatEventTime, msUntilMidnight } from '../../../shared/calendar-format';
import { useToast } from '../Toast';
import { Button } from '@/components/ui/button';

const api = window.dashboardApi;
const REFRESH_MS = 5 * 60_000;

const MESSAGES: Record<Exclude<Extract<TodayResult, { error: string }>['error'], 'offline' | 'failed'>, string> = {
  'signed-out': 'Sign in and connect Google Calendar to see today here.',
  'not-connected': 'Connect Google Calendar to see today here.',
  'needs-reconnect': 'Google access was removed. Reconnect to see today here.',
};

/** Today's events from Google Calendar; a click opens the event in the browser, the box adds one through Google's Quick Add. */
export function CalendarWidget({ onOpenConnectors }: { onOpenConnectors: () => void }) {
  const [result, setResult] = useState<TodayResult | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastState = useRef<string | null>(null);
  const toast = useToast();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const pending = useRef(false); // one add at a time: a second Enter while one runs is ignored

  const load = useCallback(() => {
    setNow(Date.now());
    api.calendarToday().then(setResult, () => setResult({ error: 'failed' }));
  }, []);

  useEffect(() => {
    load();
    const every = setInterval(load, REFRESH_MS);
    window.addEventListener('focus', load);
    // Reload when the connection really changes (connected, disconnected…), not on every push.
    const off = api.onConnectorsChanged((info) => {
      if (info.state === lastState.current) return;
      lastState.current = info.state;
      load();
    });
    return () => {
      clearInterval(every);
      window.removeEventListener('focus', load);
      off();
    };
  }, [load]);

  // A new day: re-read at midnight (re-armed by the `now` each load sets).
  useEffect(() => {
    const t = setTimeout(load, msUntilMidnight(new Date(now)) + 1000);
    return () => clearTimeout(t);
  }, [now, load]);

  const add = async () => {
    const entry = text.trim();
    if (!entry || pending.current) return;
    pending.current = true;
    setAdding(true);
    const r = await api.quickAddEvent(entry).catch(() => ({ error: 'failed' as const }));
    pending.current = false;
    setAdding(false);
    if ('error' in r) return toast(addErrorText(r.error)); // the text stays, to fix and try again
    setText((cur) => (cur.trim() === entry ? '' : cur));
    toast(`Added: ${formatAdded(r.event)}`, r.event.link ? { label: 'Open', onClick: () => api.openExternal(r.event.link) } : undefined);
    load();
  };

  const quickAdd = (
    <input
      aria-label="Add to calendar"
      placeholder="Add to calendar… e.g. Lunch tomorrow 1pm"
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
  );

  if (!result) return null;

  if ('error' in result) {
    if (result.error === 'offline' || result.error === 'failed')
      return (
        <div className="flex flex-col gap-2">
          {quickAdd}
          <div className="flex flex-col items-start gap-2 text-xs text-muted-foreground">
            {result.error === 'offline' ? "Can't reach Google." : "Couldn't load your calendar."}
            <Button size="sm" variant="outline" onClick={load}>
              Retry
            </Button>
          </div>
        </div>
      );
    return (
      <div className="flex flex-col items-start gap-2 text-xs text-muted-foreground">
        {MESSAGES[result.error]}
        <Button size="sm" variant="outline" onClick={onOpenConnectors}>
          Open Connectors
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {quickAdd}
      {result.events.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">Nothing on your calendar today</p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-xs">
          {result.events.map((e) => {
            const phase = eventPhase(e, now);
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => e.link && api.openExternal(e.link)}
                  title="Open in Google Calendar"
                  className={`flex w-full flex-col rounded px-1.5 py-1 text-left hover:bg-muted ${phase === 'past' ? 'text-muted-foreground' : ''}`}
                >
                  {/* Title over time: the card is often one column wide. */}
                  <span className={`break-words ${phase === 'now' ? 'font-medium' : ''}`}>{e.title}</span>
                  <span className="flex items-center gap-1.5 tabular-nums text-[11px] text-muted-foreground">
                    {phase === 'now' && <span aria-label="Now" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                    {formatEventTime(e)}
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
