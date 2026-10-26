// Types and channel names only: safe to import from sandboxed preloads (no zod).
import type { TranscribeLanguage, TranscriptionSettings } from './transcription';
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
  transcript: string | null; // '' = transcribed, no speech
  transcriptLang: string | null;
  transcribedAt: number | null;
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

/** A markdown text note. The body is stored exactly as typed. */
export type Page = {
  id: string;
  title: string;
  body: string;
  folderId: string | null; // null = Inbox
  starred: boolean;
  createdAt: number;
  updatedAt: number;
};

/** A card on the Home page. quick-add appends entries to pageId; page shows pageId's body. */
/** w/h: grid columns/rows spanned (1–4); absent = the type's default size. */
export type HomeWidget = (
  | { id: string; type: 'quick-add'; pageId: string; label: string }
  | { id: string; type: 'page'; pageId: string }
) & { w?: number; h?: number };

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
  homeWidgets: HomeWidget[]; // Home page cards, in order (at most 24)
  transcription: TranscriptionSettings;
  transcribeLanguage: TranscribeLanguage; // last used in the Transcribe menu
};

/** Overlay window top-left, relative to that display's work area. */
export type PillPosition = { displayId: number; x: number; y: number };

export type Theme = 'system' | 'light' | 'dark';
export type RecordingSource = 'mic' | 'system' | 'both';

export type RecordingMode = 'hold' | 'handsfree';

export type OverlayState =
  | { kind: 'idle'; visible: boolean; film?: true } // film: film mode is listening (rewind ready)
  | { kind: 'busy'; message: string }
  | { kind: 'recording'; mode: RecordingMode; startedAt: number; source: RecordingSource }
  // micOnly: 'both' was requested but system audio failed; titled: confirmation after a title was added
  | { kind: 'saved'; noteId: string; micOnly?: true; titled?: true }
  | { kind: 'error'; message: string; retry: boolean };

/** What a drag-and-drop onto the pill carried (empty string = that type was absent). */
export type DropPayload = { text: string; uriList: string; html: string };
/** A dropped item for the Review later page. title null = no usable link text. */
export type LaterItem = { kind: 'link'; url: string; title: string | null } | { kind: 'text'; text: string };

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
  // film mode / auto-pause (main → overlay, then overlay → main)
  FilmMode: 'film:mode', // { on: boolean }
  FilmSave: 'film:save', // { seconds } → answered with film:audio or film:save-error
  FilmAudio: 'film:audio', // AudioPayload of a rewind (own channel: never mistaken for a recording's audio)
  FilmSaveError: 'film:save-error', // { message }
  FilmError: 'film:error', // { message } the buffer's loopback stream failed or ended
  MediaProbe: 'media:probe', // { id } is sound playing?
  MediaProbeResult: 'media:probe-result', // { id, playing }
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
  NotesStar: 'notes:star', // { ids, starred }
  NotesSetShow: 'notes:set-show', // { id, show: string | null }
  PagesList: 'pages:list',
  PagesCreate: 'pages:create', // { folderId }
  PagesRename: 'pages:rename', // { id, title }
  PagesSetBody: 'pages:set-body', // { id, body }
  PagesMove: 'pages:move', // { ids, folderId }
  PagesStar: 'pages:star', // { ids, starred }
  PagesAppendEntry: 'pages:append-entry', // { id, text }
  PagesSetTask: 'pages:set-task', // { id, line, checked }
  PagesDeleteMany: 'pages:delete-many', // string[]
  PagesSaveImage: 'pages:save-image', // { bytes, ext } → vn-image:// url
  OpenExternal: 'app:open-external', // http(s)/mailto url
  NotesSetTranscript: 'notes:set-transcript', // { id, text } → Note
  TranscriptionGetStatus: 'transcription:get-status', // → StatusMap
  TranscriptionEnqueue: 'transcription:enqueue', // { ids, language }
  TranscriptionTest: 'transcription:test', // { baseUrl, model } → TestResult
  TranscriptionKeyInfo: 'transcription:key-info', // → KeyInfo
  TranscriptionSetKey: 'transcription:set-key', // { key } → KeyInfo
  TranscriptionRemoveKey: 'transcription:remove-key', // → KeyInfo
  TranscriptionWav: 'transcription:wav', // { requestId, bytes } | { requestId, error }
  // main → dashboard
  PagesChanged: 'pages:changed',
  NotesChanged: 'notes:changed',
  SettingsChanged: 'settings:changed',
  FoldersChanged: 'folders:changed',
  TranscriptionStatus: 'transcription:status', // StatusMap
  TranscriptionNeedWav: 'transcription:need-wav', // { requestId, bytes, mimeType } → answered on transcription:wav
} as const;

/** A voice note's transcription job; a note with no entry has none (or it finished). */
export type JobStatus = { state: 'queued' } | { state: 'running' } | { state: 'failed'; error: string };
export type StatusMap = Record<string, JobStatus>;
/** What the dashboard may know about the saved API key. */
export type KeyInfo = { saved: boolean; last4: string };
export type TestResult = { ok: true; ms: number; language: string | null } | { ok: false; error: string };
