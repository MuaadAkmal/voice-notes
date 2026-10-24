// Types and channel names only: safe to import from sandboxed preloads (no zod).
export type Note = {
  id: string;
  title: string;
  filePath: string; // relative to userData, e.g. recordings/<id>.webm
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  status: 'ok' | 'missing';
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
};

export type Settings = {
  hotkey: number[]; // uiohook keycodes
  hotkeyLabel: string;
  micDeviceId: string | null;
  launchAtLogin: boolean;
  showIdlePill: boolean;
  hotkeyPaused: boolean;
};

export type RecordingMode = 'hold' | 'handsfree';

export type OverlayState =
  | { kind: 'idle'; visible: boolean }
  | { kind: 'recording'; mode: RecordingMode; startedAt: number }
  | { kind: 'saved' }
  | { kind: 'error'; message: string; retry: boolean };

export type AudioPayload = { bytes: Uint8Array; durationMs: number; mimeType: string };

export const Ch = {
  // main → overlay
  RecorderStart: 'recorder:start', // { deviceId: string | null }
  RecorderStop: 'recorder:stop',
  RecorderCancel: 'recorder:cancel',
  OverlayState: 'overlay:state', // OverlayState
  // overlay → main
  RecorderAudio: 'recorder:audio', // AudioPayload
  RecorderError: 'recorder:error', // { message: string }
  OverlayPointer: 'overlay:pointer', // { over: boolean }
  OverlayClick: 'overlay:click',
  OverlayRetry: 'overlay:retry',
  // dashboard ↔ main (invoke)
  NotesList: 'notes:list',
  NotesRename: 'notes:rename',
  NotesDelete: 'notes:delete',
  NotesReveal: 'notes:reveal',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  HotkeyCapture: 'hotkey:capture',
  OpenRecordingsFolder: 'app:open-recordings-folder',
  // main → dashboard
  NotesChanged: 'notes:changed',
  SettingsChanged: 'settings:changed',
} as const;
