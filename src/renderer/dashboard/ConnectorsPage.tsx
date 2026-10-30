import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { GoogleCalendarCard } from './GoogleCalendarCard';
import { useConnectors } from './useConnectors';
import { DEFAULT_WAKE_WORDS, MAX_WAKE_WORDS } from '../../shared/note-command';

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
      </div>
    </div>
  );
}

/** Dictating "Pixie, add blueberry to groceries" adds to that page instead of pasting. Per PC. */
function VoiceToLists() {
  const [on, setOn] = useState<boolean | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    const load = () =>
      api.getSettings().then((s) => {
        setOn(s.voiceToLists);
        setWords(s.noteWakeWords);
        setDraft(s.noteWakeWords.join(', '));
      });
    load();
    return api.onSettingsChanged(load);
  }, []);
  if (on === null) return null;

  const name = words[0] || DEFAULT_WAKE_WORDS[0];
  const saveWords = () => {
    const next = [...new Set(draft.split(',').map((w) => w.trim()).filter(Boolean))].slice(0, MAX_WAKE_WORDS).map((w) => w.slice(0, 40));
    const list = next.length ? next : DEFAULT_WAKE_WORDS;
    setDraft(list.join(', '));
    if (list.join('\n') !== words.join('\n')) void api.setSettings({ noteWakeWords: list });
  };

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
      {on && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Wake words</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveWords}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder={DEFAULT_WAKE_WORDS[0]}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <span className="text-xs text-muted-foreground">
            A name to start with, or several separated by commas. “Hey” in front works too. Empty means{' '}
            {DEFAULT_WAKE_WORDS[0]}.
          </span>
        </label>
      )}
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
