import { GoogleCalendarCard } from './GoogleCalendarCard';

/** Outside accounts the app can use. Google Calendar is the only one so far. */
export function ConnectorsPage() {
  return (
    <div className="mx-auto max-w-3xl px-10 py-9">
      <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
      <p className="mt-1 text-sm text-muted-foreground">Connected once for your account, on every PC you sign in to.</p>
      <div className="mt-8 flex flex-col gap-4">
        <GoogleCalendarCard />
      </div>
    </div>
  );
}
