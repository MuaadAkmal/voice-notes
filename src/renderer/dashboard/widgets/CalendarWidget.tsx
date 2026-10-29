import { useCallback, useEffect, useState } from 'react';
import type { TodayResult } from '../../../shared/channels';
import { eventPhase, formatEventTime, msUntilMidnight } from '../../../shared/calendar-format';
import { Button } from '@/components/ui/button';

const api = window.dashboardApi;
const REFRESH_MS = 5 * 60_000;

const MESSAGES: Record<Exclude<Extract<TodayResult, { error: string }>['error'], 'offline' | 'failed'>, string> = {
  'signed-out': 'Sign in and connect Google Calendar to see today here.',
  'not-connected': 'Connect Google Calendar to see today here.',
  'needs-reconnect': 'Google access was removed. Reconnect to see today here.',
};

/** Today's events from Google Calendar, read-only; a click opens the event in the browser. */
export function CalendarWidget({ onOpenConnectors }: { onOpenConnectors: () => void }) {
  const [result, setResult] = useState<TodayResult | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    setNow(Date.now());
    api.calendarToday().then(setResult, () => setResult({ error: 'failed' }));
  }, []);

  useEffect(() => {
    load();
    const every = setInterval(load, REFRESH_MS);
    window.addEventListener('focus', load);
    const off = api.onConnectorsChanged(load);
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

  if (!result) return null;

  if ('error' in result) {
    if (result.error === 'offline' || result.error === 'failed')
      return (
        <div className="flex flex-col items-start gap-2 text-xs text-muted-foreground">
          {result.error === 'offline' ? "Can't reach Google." : "Couldn't load your calendar."}
          <Button size="sm" variant="outline" onClick={load}>
            Retry
          </Button>
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

  if (result.events.length === 0) return <p className="text-xs text-muted-foreground/70">Nothing on your calendar today</p>;

  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {result.events.map((e) => {
        const phase = eventPhase(e, now);
        return (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => e.link && api.openExternal(e.link)}
              title="Open in Google Calendar"
              className={`flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-muted ${phase === 'past' ? 'text-muted-foreground' : ''}`}
            >
              <span className="flex w-24 shrink-0 items-center gap-1.5 tabular-nums text-muted-foreground">
                {phase === 'now' && <span aria-label="Now" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                {formatEventTime(e)}
              </span>
              <span className={`min-w-0 break-words ${phase === 'now' ? 'font-medium' : ''}`}>{e.title}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
