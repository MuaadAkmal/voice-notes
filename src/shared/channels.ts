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
  folderId: string | null; // null = Inbox
};

export type Folder = {
  id: string;
  name: string;
  parentId: string | null; // null = top level
  createdAt: number;
  updatedAt: number;
};

export type Settings = {
  hotkey: number[]; // uiohook keycodes
  hotkeyLabel: string;
  micDeviceId: string | null;
  launchAtLogin: boolean;
  showIdlePill: boolean;
  hotkeyPaused: boolean;
  theme: Theme;
};

export type Theme = 'system' | 'light' | 'dark';

export type RecordingMode = 'hold' | 'handsfree';

export type OverlayState =
  | { kind: 'idle'; visible: boolean }
  | { kind: 'recording'; mode: RecordingMode; startedAt: number }
  | { kind: 'saved' }
  | { kind: 'error'; message: string; retry: boolean };

export type AudioDevice = { deviceId: string; label: string };

export type AudioPayload = { bytes: Uint8Array; durationMs: number; mimeType: string };

/** Most note ids one bulk IPC call carries (the dashboard preload batches larger selections). */
export const MAX_BATCH = 500;

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
  OverlayDevices: 'overlay:devices', // AudioDevice[] (ids are scoped to the overlay's origin)
  // dashboard ↔ main (invoke)
  NotesList: 'notes:list',
  NotesRename: 'notes:rename',
  NotesDelete: 'notes:delete',
  NotesReveal: 'notes:reveal',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  HotkeyCapture: 'hotkey:capture',
  OpenRecordingsFolder: 'app:open-recordings-folder',
  DevicesList: 'devices:list',
  FoldersList: 'folders:list',
  FoldersCreate: 'folders:create',
  FoldersRename: 'folders:rename',
  FoldersMove: 'folders:move',
  FoldersDelete: 'folders:delete',
  NotesMove: 'notes:move',
  NotesDeleteMany: 'notes:delete-many',
  // main → dashboard
  NotesChanged: 'notes:changed',
  SettingsChanged: 'settings:changed',
  FoldersChanged: 'folders:changed',
} as const;
