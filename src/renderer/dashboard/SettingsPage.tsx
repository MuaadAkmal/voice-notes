import { useEffect, useState } from 'react';
import type { AudioDevice, Settings } from '../../shared/channels';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Kbd } from './NotesPage';

const api = window.dashboardApi;
// Radix Select can't hold an empty value; this stands for "System default" (micDeviceId null).
const DEFAULT_MIC = 'default';

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [capturing, setCapturing] = useState(false);

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

  const changeHotkey = async () => {
    setCapturing(true);
    try {
      const { keycodes, label } = await api.captureHotkey();
      await update({ hotkey: keycodes, hotkeyLabel: label });
    } catch {
      // timed out: keep the old hotkey
    } finally {
      setCapturing(false);
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
          <Kbd>{capturing ? 'Press keys…' : settings.hotkeyLabel}</Kbd>
          <Button variant="outline" size="sm" onClick={changeHotkey} disabled={capturing}>
            Change
          </Button>
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
