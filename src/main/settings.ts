import fs from 'node:fs';
import { type Settings, SettingsFieldSchemas } from '../shared/ipc';
import { DEFAULT_TRANSCRIPTION } from '../shared/transcription';

// uiohook keycodes for Alt + Meta (Win). Literal so this module never loads the native hook.
// Not Ctrl+Win: that's the dictation key (as in Wispr Flow).
const ALT = 56;
const CTRL = 29;
const META = 3675;
const SHIFT = 42;

/** Fixed: saves the last N seconds of the film-mode buffer. A superset of the default hotkey, so it's easy to remember. */
export const REWIND_HOTKEY = [ALT, META, SHIFT];
export const REWIND_HOTKEY_LABEL = 'Alt+Win+Shift';

export const DEFAULT_SETTINGS: Settings = {
  hotkey: [ALT, META],
  hotkeyLabel: 'Alt+Win',
  micDeviceId: null,
  launchAtLogin: false,
  showIdlePill: true,
  hotkeyPaused: false,
  theme: 'system',
  recordingSource: 'mic',
  pillPosition: null,
  filmMode: false,
  rewindSeconds: 15,
  autoPause: true,
  homeWidgets: [],
  transcription: DEFAULT_TRANSCRIPTION,
  transcribeLanguage: 'auto',
  laterPageId: null,
  dictationHotkey: [CTRL, META],
  dictationHotkeyLabel: 'Ctrl+Win',
  dictationSound: true,
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
