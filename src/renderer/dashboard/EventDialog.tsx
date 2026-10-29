import type { CalendarEvent } from '../../shared/channels';
import { formatEventRange, formatEventTime } from '../../shared/calendar-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const api = window.dashboardApi;

/** One event's details, read-only; changes happen in Google Calendar. */
export function EventDialog({ event, onClose }: { event: CalendarEvent | null; onClose: () => void }) {
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {event && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display break-words">{event.title}</DialogTitle>
              <DialogDescription>{formatEventRange(event)}</DialogDescription>
            </DialogHeader>
            {(event.location || event.description) && (
              <div className="flex flex-col gap-3 text-sm">
                {event.location && <p className="break-words">{event.location}</p>}
                {event.description && (
                  <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground">{event.description}</p>
                )}
              </div>
            )}
            <DialogFooter>
              {event.link && (
                <Button variant="outline" onClick={() => api.openExternal(event.link)}>
                  Open in Google Calendar
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Every event of one day, for a cell with more than fits. */
export function DayEventsDialog({
  day,
  events,
  onPick,
  onClose,
}: {
  day: Date | null;
  events: CalendarEvent[];
  onPick: (e: CalendarEvent) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {day?.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </DialogTitle>
        </DialogHeader>
        <ul className="-mx-2 flex max-h-96 flex-col gap-0.5 overflow-y-auto text-sm">
          {events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onPick(e)}
                className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="w-24 shrink-0 tabular-nums text-xs text-muted-foreground">{formatEventTime(e)}</span>
                <span className="break-words">{e.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
