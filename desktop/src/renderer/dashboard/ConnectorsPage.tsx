import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { GoogleCalendarCard } from './GoogleCalendarCard';
import { useConnectors } from './useConnectors';
import { DEFAULT_WAKE_WORDS } from '../../shared/note-command';

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
        <VoiceToLists />
        <LanguageLearner />
      </div>
    </div>
  );
}

/** Dictating "Pixie, add blueberry to groceries" adds to that page instead of pasting. Per PC. */
function VoiceToLists() {
  const [on, setOn] = useState<boolean | null>(null);
  const [folders, setFolders] = useState(true);
  const [reminders, setReminders] = useState(true);
  useEffect(() => {
    const load = () =>
      api.getSettings().then((s) => {
        setOn(s.voiceToLists);
        setFolders(s.voiceToFolders);
        setReminders(s.voiceReminders);
      });
    load();
    return api.onSettingsChanged(load);
  }, []);
  if (on === null) return null;

  const name = DEFAULT_WAKE_WORDS[0];

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium">Voice to lists</div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            Dictate “{name}, add blueberry to my grocery list” to add it to that page; anything that fits no page goes to
            Quick notes. While signed in, the command and your page titles (never their contents) are sent to Groq to
            pick the page.
          </div>
        </div>
        <Switch
          aria-label="Voice to lists"
          checked={on}
          onCheckedChange={(v) => {
            setOn(v);
            void api.setSettings({ voiceToLists: v });
          }}
        />
      </div>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Voice notes too</div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            Start a voice note with “{name}, movie lines …” to file it into that folder. The first seconds are
            transcribed to check, so transcription must be set up.
          </div>
        </div>
        <Switch
          aria-label="Voice to folders"
          checked={folders}
          onCheckedChange={(v) => {
            setFolders(v);
            void api.setSettings({ voiceToFolders: v });
          }}
        />
      </div>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Reminders</div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            Dictate “Remind me to call mom in 10 minutes” for a notification on this PC (and a Google Calendar event while
            connected). Times it can't read are sent to Groq while signed in.
          </div>
        </div>
        <Switch
          aria-label="Voice reminders"
          checked={reminders}
          onCheckedChange={(v) => {
            setReminders(v);
            void api.setSettings({ voiceReminders: v });
          }}
        />
      </div>
    </div>
  );
}

/** "Pixie, I learned a new word in Tamil, vanakkam" goes on the Tamil page with how it sounds and what it means. Per PC. */
function LanguageLearner() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    const load = () => api.getSettings().then((s) => setOn(s.languageLearner));
    load();
    return api.onSettingsChanged(load);
  }, []);
  if (on === null) return null;
  const name = DEFAULT_WAKE_WORDS[0];

  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-card p-5">
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium">Language learner</div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          Say “{name}, I learned a new word in Tamil, vanakkam” and it's added to your Tamil page with how it sounds and what it
          means. Uses Voice to lists, so the page needs to exist.
        </div>
      </div>
      <Switch
        aria-label="Language learner"
        checked={on}
        onCheckedChange={(v) => {
          setOn(v);
          void api.setSettings({ languageLearner: v });
        }}
      />
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
