import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { GoogleCalendarCard } from './GoogleCalendarCard';
import { useConnectors } from './useConnectors';

const api = window.dashboardApi;

/** Outside accounts the app can use. Google Calendar is the only one so far. */
export function ConnectorsPage() {
  return (
    <div className="mx-auto max-w-3xl px-10 py-9">
      <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
      <p className="mt-1 text-sm text-muted-foreground">Connected once for your account, on every PC you sign in to.</p>
      <div className="mt-8 flex flex-col gap-4">
        <GoogleCalendarCard />
        <VoiceToCalendar />
      </div>
    </div>
  );
}

/** Dictating "Calendar, lunch tomorrow 1pm" adds an event instead of pasting. Per PC. */
function VoiceToCalendar() {
  const info = useConnectors();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    const load = () => api.getSettings().then((s) => setOn(s.voiceToCalendar));
    load();
    return api.onSettingsChanged(load);
  }, []);
  if (on === null || (info?.state !== 'connected' && info?.state !== 'needs-reconnect')) return null;

  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-card p-5">
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium">Voice to calendar</div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          Dictate “Calendar, lunch tomorrow 1pm” to add an event instead of pasting the text.
        </div>
      </div>
      <Switch
        aria-label="Voice to calendar"
        checked={on}
        onCheckedChange={(v) => {
          setOn(v);
          void api.setSettings({ voiceToCalendar: v });
        }}
      />
    </div>
  );
}
