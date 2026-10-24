import { useEffect, useState } from 'react';
import type { AudioDevice, Settings } from '../../shared/channels';
import { Kbd } from './NotesPage';

const api = window.dashboardApi;

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

      <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
        <Row
          title="Recording hotkey"
          hint="Hold to record, double-tap for hands-free. Other apps still receive these keys."
        >
          <Kbd>{capturing ? 'Press keys…' : settings.hotkeyLabel}</Kbd>
          <button onClick={changeHotkey} disabled={capturing} className={buttonClass}>
            Change
          </button>
        </Row>

        <Row title="Microphone">
          <select
            value={settings.micDeviceId ?? ''}
            onChange={(e) => update({ micDeviceId: e.target.value || null })}
            className="max-w-64 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-stone-500"
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </Row>

        <Row title="Launch at login" hint="Starts quietly in the tray.">
          <Toggle checked={settings.launchAtLogin} onChange={(v) => update({ launchAtLogin: v })} />
        </Row>

        <Row title="Show pill when idle" hint="When off, the pill only appears while recording.">
          <Toggle checked={settings.showIdlePill} onChange={(v) => update({ showIdlePill: v })} />
        </Row>

        <Row title="Recordings folder">
          <button onClick={() => api.openRecordingsFolder()} className={buttonClass}>
            Open folder
          </button>
        </Row>
      </div>
    </div>
  );
}

const buttonClass =
  'rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50';

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-xs text-stone-500">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 rounded-full transition-colors ${checked ? 'bg-stone-900' : 'bg-stone-300'}`}
    >
      <span
        // left-0 matters: without it the absolute knob sits at its static position, which a <button> centers.
        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
