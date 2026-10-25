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
  source: RecordingSource; // what was captured
  kind: NoteKind;
  windowTitle: string | null; // foreground window when recording started
  show: string | null; // cleaned-up label from windowTitle, editable
  starred: boolean;
};

/** 'rewind': the last N seconds of system audio, saved from the film-mode buffer. */
export type NoteKind = 'note' | 'rewind';

/** Where a note was recorded from: the foreground window, and the show label derived from it. */
export type NoteContext = { windowTitle: string; show: string | null };

export const REWIND_SECONDS = [10, 15, 30, 60] as const;
export type RewindSeconds = (typeof REWIND_SECONDS)[number];

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
  recordingSource: RecordingSource;
  pillPosition: PillPosition | null; // null = bottom-centre of the primary display
  filmMode: boolean; // keep a rolling system-audio buffer for rewind; forced off at every launch
  rewindSeconds: RewindSeconds;
  autoPause: boolean; // pause playing media while recording a mic note
};

/** Overlay window top-left, relative to that display's work area. */
export type PillPosition = { displayId: number; x: number; y: number };

export type Theme = 'system' | 'light' | 'dark';
export type RecordingSource = 'mic' | 'system' | 'both';

export type RecordingMode = 'hold' | 'handsfree';

export type OverlayState =
  | { kind: 'idle'; visible: boolean }
  | { kind: 'recording'; mode: RecordingMode; startedAt: number; source: RecordingSource }
  // micOnly: 'both' was requested but system audio failed; titled: confirmation after a title was added
  | { kind: 'saved'; noteId: string; micOnly?: true; titled?: true }
  | { kind: 'error'; message: string; retry: boolean };

export type AudioDevice = { deviceId: string; label: string };

export type AudioPayload = { bytes: Uint8Array; durationMs: number; mimeType: string; source: RecordingSource };

/** Most note ids one bulk IPC call carries (the dashboard preload batches larger selections). */
export const MAX_BATCH = 500;

export const Ch = {
  // main → overlay
  RecorderStart: 'recorder:start', // { deviceId: string | null; source: RecordingSource }
  RecorderStop: 'recorder:stop',
  RecorderCancel: 'recorder:cancel',
  OverlayState: 'overlay:state', // OverlayState
  // overlay → main
  RecorderAudio: 'recorder:audio', // AudioPayload
  RecorderError: 'recorder:error', // { message: string }
  OverlayPointer: 'overlay:pointer', // { over: boolean }
  OverlayClick: 'overlay:click',
  OverlayRetry: 'overlay:retry',
  OverlayDrag: 'overlay:drag', // { dx: number; dy: number } screen px since the last move
  OverlayDragEnd: 'overlay:drag-end',
  OverlayTitleStart: 'overlay:title-start',
  OverlayTitle: 'overlay:title', // { noteId, title }
  OverlayTitleCancel: 'overlay:title-cancel',
  OverlayDiscard: 'overlay:discard', // the hands-free × (same as Esc)
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
