import fs from 'node:fs';
import { type Settings, SettingsFieldSchemas } from '../shared/ipc';
import { DEFAULT_LATER_SITES } from '../shared/later-routes';
import { DEFAULT_WAKE_WORDS } from '../shared/note-command';
import { DEFAULT_POMODORO } from '../shared/pomodoro';
import { SYNCED_KEYS } from '../shared/sync-ops';
import { DEFAULT_TRANSCRIPTION, type ModelId } from '../shared/transcription';

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
  pillFollowsFocus: true,
  filmMode: false,
  rewindSeconds: 15,
  autoPause: true,
  homeWidgets: [],
  transcription: DEFAULT_TRANSCRIPTION,
  transcribeLanguage: 'auto',
  laterPageId: null,
  notesPageId: null,
  laterSites: DEFAULT_LATER_SITES,
  dictationHotkey: [CTRL, META],
  dictationHotkeyLabel: 'Ctrl+Win',
  dictationSound: true,
  dictationCleanup: null,
  voiceToCalendar: true,
  voiceReminders: true,
  voiceToLists: true,
  voiceToFolders: true,
  noteWakeWords: DEFAULT_WAKE_WORDS,
  pomodoro: DEFAULT_POMODORO,
  autoTranscribe: true,
  autoTitle: true,
  customWords: [],
  cloudWarnedPeriod: null,
  cloudOutPeriod: null,
  languageLearner: false,
  onboarded: false,
  onboardingPending: false,
  newLines: {},
  storageWarned: null,
};

function readRaw(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Settings live in two files: this PC's (pc.json, at the root) and the account's synced ones (profile.json, in the profile). */
export type SettingsFiles = { pc: string; profile: string };

const isSynced = (key: string) => (SYNCED_KEYS as readonly string[]).includes(key);

/** Divides settings by `SYNCED_KEYS`: the synced ones belong to the profile, everything else to the PC. */
export function splitSettings(s: Record<string, unknown>): { pc: Record<string, unknown>; profile: Record<string, unknown> } {
  const pc: Record<string, unknown> = {};
  const profile: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(s)) (isSynced(key) ? profile : pc)[key] = value;
  return { pc, profile };
}

/** Defaults, overridden field-by-field by whatever valid value the key's own file has. Never throws. */
export function loadSettings(files: SettingsFiles): Settings {
  const pc = readRaw(files.pc);
  const profile = readRaw(files.profile);
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [key, schema] of Object.entries(SettingsFieldSchemas)) {
    const raw = isSynced(key) ? profile : pc;
    const parsed = schema.safeParse(raw[key]);
    if (key in raw && parsed.success) result[key] = parsed.data;
  }
  return result as Settings;
}

/** The built-in model's file is gone (deleted outside the app): transcription is not set up any more. Same object when nothing changes. */
export function normaliseLocal(s: Settings, modelInstalled: (id: ModelId) => boolean): Settings {
  const t = s.transcription;
  if (t.provider !== 'local' || (t.localModel && modelInstalled(t.localModel))) return s;
  return { ...s, transcription: { ...t, provider: null } };
}

export function saveSettings(files: SettingsFiles, patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(files), ...patch };
  const { pc, profile } = splitSettings(next);
  writeJson(files.pc, pc);
  writeJson(files.profile, profile);
  return next;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}
