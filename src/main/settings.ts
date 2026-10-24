import fs from 'node:fs';
import { type Settings, SettingsFieldSchemas } from '../shared/ipc';

// uiohook keycodes for Ctrl + Meta (Win). Literal so this module never loads the native hook.
const CTRL = 29;
const META = 3675;

export const DEFAULT_SETTINGS: Settings = {
  hotkey: [CTRL, META],
  hotkeyLabel: 'Ctrl+Win',
  micDeviceId: null,
  launchAtLogin: false,
  showIdlePill: true,
  hotkeyPaused: false,
};

function readRaw(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Defaults, overridden field-by-field by whatever in the file is valid. Never throws. */
export function loadSettings(file: string): Settings {
  const raw = readRaw(file);
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [key, schema] of Object.entries(SettingsFieldSchemas)) {
    const parsed = schema.safeParse(raw[key]);
    if (key in raw && parsed.success) result[key] = parsed.data;
  }
  return result as Settings;
}

export function saveSettings(file: string, patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(file), ...patch };
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return next;
}
