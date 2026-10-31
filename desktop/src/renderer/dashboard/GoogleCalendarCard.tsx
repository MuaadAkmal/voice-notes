import { CalendarDays } from 'lucide-react';
import { cleanIpcError } from '../../shared/format';
import { addWidget, hasCalendar } from '../../shared/home-widgets';
import { Button } from '@/components/ui/button';
import { useConfirm } from './ConfirmDialog';
import { useToast } from './Toast';
import { useConnectors } from './useConnectors';
import { useHomeWidgets } from './useHomeWidgets';

const api = window.dashboardApi;

/** Connect, wait for the browser, Connected as …, Disconnect; or sign in first. */
export function GoogleCalendarCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const info = useConnectors();
  const { widgets, save } = useHomeWidgets();
  if (!info) return null;

  const run = (p: Promise<unknown>) => p.catch((e) => toast(cleanIpcError(e)));
  const disconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect Google Calendar? Voice Notes will lose access on every PC.',
      confirmLabel: 'Disconnect',
    });
    if (ok) run(api.disconnectGoogle());
  };
  const addToHome = () =>
    run(save((cur) => addWidget(cur, { id: crypto.randomUUID(), type: 'calendar' })).then(() => toast('Added to Home')));

  let detail: React.ReactNode;
  let action: React.ReactNode;
  switch (info.state) {
    case 'signed-out':
      detail = 'Sign in to connect Google Calendar.';
      action = (
        <Button size="sm" onClick={() => run(api.signIn())}>
          Sign in
        </Button>
      );
      break;
    case 'disconnected':
      detail = (
        <>
          See today's events on Home. Voice Notes asks Google for access to your calendar events.
          {info.error && <span className="mt-1 block text-destructive">{info.error}</span>}
        </>
      );
      action = (
        <Button size="sm" onClick={() => run(api.connectGoogle())}>
          Connect
        </Button>
      );
      break;
    case 'connecting':
      detail = 'Waiting for browser…';
      action = (
        <Button size="sm" variant="outline" onClick={() => run(api.cancelConnect())}>
          Cancel
        </Button>
      );
      break;
    case 'connected':
      detail = `Connected as ${info.email}`;
      action = (
        <Button size="sm" variant="outline" onClick={disconnect}>
          Disconnect
        </Button>
      );
      break;
    case 'needs-reconnect':
      detail = 'Google access was removed.';
      action = (
        <Button size="sm" onClick={() => run(api.connectGoogle())}>
          Reconnect
        </Button>
      );
      break;
  }

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-start gap-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted">
          <CalendarDays className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium">Google Calendar</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{detail}</div>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      {info.state === 'connected' && widgets && !hasCalendar(widgets) && (
        <div className="mt-4 border-t pt-4">
          <Button size="sm" variant="secondary" onClick={addToHome}>
            Add Today's calendar to Home
          </Button>
        </div>
      )}
    </div>
  );
}
