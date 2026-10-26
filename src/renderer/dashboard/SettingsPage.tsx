import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { type AudioDevice, type RecordingSource, REWIND_SECONDS, type RewindSeconds, type Settings, type Theme } from '../../shared/channels';
import { sameCombo } from '../../shared/dictation';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Kbd } from './NotesPage';
import { useToast } from './Toast';

const api = window.dashboardApi;
const THEMES: { value: Theme; label: string; Icon: typeof Monitor }[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];
const SOURCES: { value: RecordingSource; label: string }[] = [
  { value: 'mic', label: 'Microphone' },
  { value: 'system', label: 'System audio' },
  { value: 'both', label: 'Mic + system audio' },
];
// Alt+Win+Shift (uiohook Alt, Meta, Shift): the fixed rewind combo.
const REWIND_COMBO = [56, 3675, 42];
// Radix Select can't hold an empty value; this stands for "System default" (micDeviceId null).
const DEFAULT_MIC = 'default';

export function SettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [capturing, setCapturing] = useState<'hotkey' | 'dictation' | null>(null);

  useEffect(() => {
    const load = () => {
      api.getSettings().then(setSettings);
      api.listDevices().then(setDevices);
    };
    load();
    return api.onSettingsChanged(load);
  }, []);

  if (!settings) return null;
  const update = (patch: Partial<Settings>) => api.setSettings(patch).then(setSettings);

  // Each hotkey must differ from the other and from the rewind combo, or two actions would fire.
  const changeHotkey = async (which: 'hotkey' | 'dictation') => {
    setCapturing(which);
    try {
      const { keycodes, label } = await api.captureHotkey();
      const others = which === 'hotkey' ? [settings.dictationHotkey, REWIND_COMBO] : [settings.hotkey, REWIND_COMBO];
      if (others.some((o) => sameCombo(o, keycodes))) {
        toast('That shortcut is already used');
        return;
      }
      await update(which === 'hotkey' ? { hotkey: keycodes, hotkeyLabel: label } : { dictationHotkey: keycodes, dictationHotkeyLabel: label });
    } catch {
      // timed out: keep the old hotkey
    } finally {
      setCapturing(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-10 py-9">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Settings</h1>

      <div className="divide-y divide-border rounded-2xl border bg-card">
        <Row
          title="Recording hotkey"
          hint="Hold to record, double-tap for hands-free. Other apps still receive these keys."
        >
          <Kbd>{capturing === 'hotkey' ? 'Press keys…' : settings.hotkeyLabel}</Kbd>
          <Button variant="outline" size="sm" aria-label="Change recording hotkey" onClick={() => changeHotkey('hotkey')} disabled={capturing !== null}>
            Change
          </Button>
        </Row>

        <Row
          title="Dictation hotkey"
          hint="Hold to dictate into any app, double-tap for hands-free. Uses your Transcription server."
        >
          <Kbd>{capturing === 'dictation' ? 'Press keys…' : settings.dictationHotkeyLabel}</Kbd>
          <Button variant="outline" size="sm" aria-label="Change dictation hotkey" onClick={() => changeHotkey('dictation')} disabled={capturing !== null}>
            Change
          </Button>
        </Row>

        <Row title="Dictation start sound" hint="A soft ping when dictation starts listening.">
          <Switch
            aria-label="Dictation start sound"
            checked={settings.dictationSound}
            onCheckedChange={(v) => update({ dictationSound: v })}
          />
        </Row>

        <Row title="Appearance" hint="System follows your Windows light/dark setting.">
          <div role="group" aria-label="Appearance" className="flex rounded-lg border bg-muted p-0.5">
            {THEMES.map(({ value, label, Icon }) => (
              <button
                key={value}
                aria-pressed={settings.theme === value}
                onClick={() => update({ theme: value })}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </Row>

        <Row
          title="Record from"
          hint="System audio captures whatever your PC is playing (the film's line), with headphones too. Some streaming sites with DRM, like Netflix in Chrome or Edge, may record silence."
        >
          <Select value={settings.recordingSource} onValueChange={(v) => update({ recordingSource: v as RecordingSource })}>
            <SelectTrigger className="w-64" aria-label="Record from">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          title="Film mode"
          hint="Keeps the last minute of system audio in memory (never written to disk) so the rewind hotkey can save the line you just heard. Turns off when the app restarts."
        >
          <Switch aria-label="Film mode" checked={settings.filmMode} onCheckedChange={(v) => update({ filmMode: v })} />
        </Row>

        <Row title="Rewind" hint="In film mode, saves this much of what just played.">
          <Kbd>Alt+Win+Shift</Kbd>
          <Select value={String(settings.rewindSeconds)} onValueChange={(v) => update({ rewindSeconds: Number(v) as RewindSeconds })}>
            <SelectTrigger className="w-32" aria-label="Rewind length">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REWIND_SECONDS.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  Last {s} s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row title="Pause media while recording" hint="For microphone notes: pauses the film if something is playing and resumes it when you stop.">
          <Switch
            aria-label="Pause media while recording"
            checked={settings.autoPause}
            onCheckedChange={(v) => update({ autoPause: v })}
          />
        </Row>

        <Row title="Microphone">
          <Select
            value={settings.micDeviceId ?? DEFAULT_MIC}
            onValueChange={(v) => update({ micDeviceId: v === DEFAULT_MIC ? null : v })}
          >
            <SelectTrigger className="w-64" aria-label="Microphone">
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
        </Row>

        <Row title="Launch at login" hint="Starts quietly in the tray.">
          <Switch
            aria-label="Launch at login"
            checked={settings.launchAtLogin}
            onCheckedChange={(v) => update({ launchAtLogin: v })}
          />
        </Row>

        <Row title="Show pill when idle" hint="When off, the pill only appears while recording.">
          <Switch
            aria-label="Show pill when idle"
            checked={settings.showIdlePill}
            onCheckedChange={(v) => update({ showIdlePill: v })}
          />
        </Row>

        <Row title="Pill position" hint="Drag the pill anywhere on screen; it remembers the spot.">
          <Button variant="outline" size="sm" disabled={!settings.pillPosition} onClick={() => update({ pillPosition: null })}>
            Reset pill position
          </Button>
        </Row>

        <Row title="Recordings folder">
          <Button variant="outline" size="sm" onClick={() => api.openRecordingsFolder()}>
            Open folder
          </Button>
        </Row>
      </div>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}
