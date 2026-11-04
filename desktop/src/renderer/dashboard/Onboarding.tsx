import { useEffect, useRef, useState } from 'react';
import { Check, Cloud, Cpu, Mic, Server } from 'lucide-react';
import type { AudioDevice, Note, Settings } from '../../shared/channels';
import { DEFAULT_WAKE_WORDS } from '../../shared/note-command';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Logo } from './Logo';

// A new account's first launch: mic, provider, a first note, a first Pixie command, and what else
// can be said. Every step can be skipped; finishing or skipping marks the account onboarded.

const api = window.dashboardApi;
const DEFAULT_MIC = 'default';
const REWIND_LABEL = 'Alt+Win+Shift'; // fixed in main (REWIND_HOTKEY_LABEL)
const STEPS = ['welcome', 'mic', 'provider', 'hotkey', 'pixie', 'say'] as const;
type Step = (typeof STEPS)[number];
type Provider = 'cloud' | 'local' | 'server';

export function Onboarding({ onDone }: { onDone: (openTranscription: boolean) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [step, setStep] = useState<Step>('welcome');
  const [provider, setProvider] = useState<Provider>('cloud');
  useEffect(() => {
    api.getSettings().then(setSettings);
    return api.onSettingsChanged(() => api.getSettings().then(setSettings));
  }, []);
  if (!settings) return null;

  const at = STEPS.indexOf(step);
  const finish = () => {
    void api.finishOnboarding().then(() => onDone(provider !== 'cloud'));
  };
  const next = async () => {
    if (step === 'provider' && provider === 'cloud' && settings.transcription.provider !== 'cloud')
      setSettings(await api.setSettings({ transcription: { ...settings.transcription, provider: 'cloud' } }));
    if (at === STEPS.length - 1) finish();
    else setStep(STEPS[at + 1]);
  };
  const wake = settings.noteWakeWords[0] || DEFAULT_WAKE_WORDS[0];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground" role="dialog" aria-label="Welcome to Voice Notes">
      <div className="app-drag h-10 shrink-0" />
      <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col px-8 pb-8">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5" aria-label={`Step ${at + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <span key={s} className={cn('h-1.5 w-6 rounded-full', i <= at ? 'bg-primary' : 'bg-muted')} />
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip
          </Button>
        </div>

        {/* Scrolls on its own so Back / Next stay on screen in a small window. */}
        <div className="-mx-2 mt-10 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {step === 'welcome' && (
            <>
              <Logo className="h-8 w-auto" />
              <h1 className="mt-6 text-2xl font-semibold tracking-tight">Welcome to Voice Notes</h1>
              <p className="mt-2 text-muted-foreground">
                Voice Notes turns what you say into notes, lists and reminders. Let's set it up — it takes a minute.
              </p>
            </>
          )}
          {step === 'mic' && <MicStep settings={settings} onChange={(s) => setSettings(s)} />}
          {step === 'provider' && <ProviderStep provider={provider} onChange={setProvider} />}
          {step === 'hotkey' && <HotkeyStep label={settings.hotkeyLabel} />}
          {step === 'pixie' && <PixieStep label={settings.dictationHotkeyLabel} wake={wake} />}
          {step === 'say' && <SayStep settings={settings} wake={wake} />}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t pt-4">
          <Button variant="ghost" disabled={at === 0} onClick={() => setStep(STEPS[at - 1])}>
            Back
          </Button>
          <Button onClick={() => void next()}>
            {step === 'say' ? 'Start using Voice Notes' : step === 'welcome' ? 'Get started' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MicStep({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<'idle' | 'listening' | 'heard' | 'silent' | 'busy' | 'error'>('idle');
  const heard = useRef(false);
  useEffect(() => void api.listDevices().then(setDevices), []);
  useEffect(
    () =>
      api.onMicLevel((l) => {
        setLevel(l.level);
        if (l.heard) heard.current = true;
        if (l.done) setResult(l.error ? 'error' : heard.current ? 'heard' : 'silent');
      }),
    [],
  );
  const test = async () => {
    heard.current = false;
    setLevel(0);
    const r = await api.testMic(settings.micDeviceId);
    setResult(r.ok ? 'listening' : 'busy');
  };
  const message = {
    idle: 'Press Test mic and say something.',
    listening: 'Listening…',
    heard: 'We hear you ✓',
    silent: 'No sound — pick another mic',
    busy: 'Busy, try again',
    error: "Couldn't open that mic — pick another",
  }[result];

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Check your mic</h1>
      <div className="mt-6 flex items-center gap-3">
        <Mic className="size-5 text-muted-foreground" />
        <Select
          value={settings.micDeviceId ?? DEFAULT_MIC}
          onValueChange={(v) => void api.setSettings({ micDeviceId: v === DEFAULT_MIC ? null : v }).then(onChange)}
        >
          <SelectTrigger className="w-72" aria-label="Microphone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_MIC}>System default</SelectItem>
            {devices.map((d) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={result === 'listening'} onClick={() => void test()}>
          Test mic
        </Button>
      </div>
      <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-muted" aria-label="Mic level">
        <div className="h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <p className={cn('mt-3 text-sm', result === 'heard' ? 'text-primary' : 'text-muted-foreground')}>{message}</p>
    </>
  );
}

function ProviderStep({ provider, onChange }: { provider: Provider; onChange: (p: Provider) => void }) {
  const options: { id: Provider; icon: typeof Cloud; name: string; text: string }[] = [
    { id: 'cloud', icon: Cloud, name: 'Voice Notes Cloud', text: 'Fast and accurate, nothing to set up. 30 free minutes a month.' },
    { id: 'local', icon: Cpu, name: 'Built-in', text: 'Runs on this PC after a one-time download. Nothing is sent anywhere.' },
    { id: 'server', icon: Server, name: 'My server', text: 'Your own Whisper server (OpenAI-compatible).' },
  ];
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">How should notes be transcribed?</h1>
      <div className="mt-6 flex flex-col gap-2" role="radiogroup" aria-label="Transcription">
        {options.map(({ id, icon: Icon, name, text }) => (
          <button
            key={id}
            role="radio"
            aria-checked={provider === id}
            onClick={() => onChange(id)}
            className={cn(
              'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
              provider === id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
            )}
          >
            <Icon className="mt-0.5 size-5 text-muted-foreground" />
            <span>
              <span className="block text-sm font-medium">{name}</span>
              <span className="block text-sm text-muted-foreground">{text}</span>
            </span>
          </button>
        ))}
      </div>
      {provider !== 'cloud' && <p className="mt-3 text-sm text-muted-foreground">You'll set it up on the Transcription page when you finish.</p>}
    </>
  );
}

/** Watches for a note recorded after the step opened. */
function HotkeyStep({ label }: { label: string }) {
  const since = useRef(Date.now());
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    const look = () => api.listNotes().then((ns) => setNote(ns.find((n) => n.createdAt >= since.current) ?? null));
    return api.onNotesChanged(look);
  }, []);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Record your first note</h1>
      <p className="mt-2 text-muted-foreground">
        Press <Kbd>{label}</Kbd>, say something, then press it again. Or hold it while you talk.
      </p>
      <Done shown={!!note} text="Saved ✓" detail={note?.transcript || (note ? 'Transcribing…' : null)} />
    </>
  );
}

/** Watches the starter Grocery list for a new line. */
function PixieStep({ label, wake }: { label: string; wake: string }) {
  const start = useRef<number | null>(null);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    const look = () =>
      api.listPages().then((ps) => {
        const lines = (ps.find((p) => p.title === 'Grocery list')?.body ?? '').split('\n').length;
        if (start.current === null) start.current = lines;
        else if (lines > start.current) setAdded(true);
      });
    void look();
    return api.onPagesChanged(look);
  }, []);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Talk to your lists</h1>
      <p className="mt-2 text-muted-foreground">
        Hold <Kbd>{label}</Kbd> and say “{wake}, add milk to my grocery list”. Without “{wake}”, the same key types what you say into
        any app.
      </p>
      <Done shown={added} text="Added to Grocery list ✓" detail={null} />
    </>
  );
}

function SayStep({ settings, wake }: { settings: Settings; wake: string }) {
  const groups: { title: string; lines: [string, string][] }[] = [
    {
      title: 'Keys',
      lines: [
        [settings.hotkeyLabel, 'Record a voice note (press, or hold while you talk)'],
        [settings.dictationHotkeyLabel, 'Dictate into any app'],
        [REWIND_LABEL, 'Save the last seconds of what was playing (turn on Film mode first)'],
      ],
    },
    {
      title: `While dictating (${settings.dictationHotkeyLabel})`,
      lines: [
        [`“${wake}, add … to …”`, 'Adds to that page; Undo or Move it from the pill'],
        ['“Calendar, lunch tomorrow 1pm”', 'An event in Google Calendar (connect it on Connectors)'],
        ['“Remind me to … in 10 minutes”', 'A reminder on this PC'],
      ],
    },
    {
      title: `In a voice note (${settings.hotkeyLabel})`,
      lines: [[`“${wake}, <folder>” first`, 'Files the note into that folder']],
    },
    {
      title: 'On the pill',
      lines: [
        ['Save this', "Saves the page or window you're looking at for later"],
        ['Drop a link', 'Drag a link or text onto the pill to save it for later'],
      ],
    },
  ];
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">What you can say</h1>
      <div className="mt-6 flex flex-col gap-5">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h2>
            <dl className="divide-y divide-border rounded-xl border">
              {g.lines.map(([what, does]) => (
                <div key={what} className="flex gap-4 px-4 py-2 text-sm">
                  <dt className="w-56 shrink-0 font-medium">{what}</dt>
                  <dd className="text-muted-foreground">{does}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}

function Done({ shown, text, detail }: { shown: boolean; text: string; detail: string | null }) {
  if (!shown) return <p className="mt-6 text-sm text-muted-foreground">Waiting for you… or press Next to do it later.</p>;
  return (
    <div className="mt-6 flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
      <Check className="mt-0.5 size-4 text-primary" />
      <div>
        <div className="font-medium">{text}</div>
        {detail && <div className="mt-0.5 text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</kbd>
);
