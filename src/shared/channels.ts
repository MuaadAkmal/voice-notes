// Types and channel names only: safe to import from sandboxed preloads (no zod).
import type { ModelId, TranscribeLanguage, TranscriptionSettings } from './transcription';
export type Note = {
  id: string;
  title: string;
  filePath: string; // relative to userData, e.g. recordings/<id>.webm
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  status: 'ok' | 'missing' | 'remote'; // remote: in the account, not downloaded to this PC yet
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
  | { id: string; type: 'calendar'; pageId?: never } // Today's calendar: no page, at most one
) & { w?: number; h?: number; locked?: true }; // locked: the built-in Review later card, never removed

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
  laterPageId: string | null; // the built-in Review later page; created at boot
  notesPageId: string | null; // the built-in Quick notes page, where "Note, …" lands when no page matches; created at boot
  dictationHotkey: number[]; // uiohook keycodes: hold to dictate into the focused app
  dictationHotkeyLabel: string;
  dictationSound: boolean; // a ping when dictation starts listening
  voiceToCalendar: boolean; // "Calendar, …" dictations become Google Calendar events while connected
  voiceToLists: boolean; // "List, …" dictations add to a page (via the `commands` function) while signed in
  noteWakeWords: string[]; // the names that start a voice-to-lists command ("Pixie, …"); empty = Pixie
  pomodoro: PomodoroSettings;
};

/** Overlay window top-left, relative to that display's work area. */
export type PillPosition = { displayId: number; x: number; y: number };

export type Theme = 'system' | 'light' | 'dark';
export type RecordingSource = 'mic' | 'system' | 'both';

export type RecordingMode = 'hold' | 'handsfree';

export type OverlayState =
  | { kind: 'idle'; visible: boolean; film?: true } // film: film mode is listening (rewind ready)
  | { kind: 'busy'; message: string }
  | { kind: 'recording'; mode: RecordingMode; startedAt: number; source: RecordingSource; dictation?: true }
  // micOnly: 'both' was requested but system audio failed; titled: confirmation after a title was added
  | { kind: 'saved'; noteId: string; micOnly?: true; titled?: true }
  | { kind: 'error'; message: string; retry: boolean }
  | { kind: 'done'; message: string }; // a short success, e.g. a dictation added to the calendar

/** What a drag-and-drop onto the pill carried (empty string = that type was absent). */
export type DropPayload = { text: string; uriList: string; html: string };
/** A dropped item for the Review later page. title null = no usable link text. */
export type LaterItem = { kind: 'link'; url: string; title: string | null } | { kind: 'text'; text: string };

/** A dictation's text, kept for 24 h. app: show label of the window it was dictated into. */
/** Lengths in minutes; a long break replaces every `longBreakEvery`th break. Per PC, never synced. */
export type PomodoroSettings = {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number;
  autoStartBreaks: boolean; // off: a finished focus waits for Start on the break
  autoStartFocus: boolean;
  sound: boolean; // the chime when a phase ends
  dailyGoal: number; // sessions a day, for the Pomodoro page
};
/** A finished focus phase (skipped ones don't count). */
export type PomodoroSession = { completedAt: number; focusMs: number };
export type PomodoroAction = 'start' | 'pause' | 'resume' | 'skip' | 'stop';

export type Dictation = { id: string; text: string; app: string | null; createdAt: number };
/** A dictation clip from the overlay, already 16 kHz mono WAV. */
export type DictationAudio = { bytes: Uint8Array; durationMs: number };

export type AudioDevice = { deviceId: string; label: string };

export type AudioPayload = { bytes: Uint8Array; durationMs: number; mimeType: string; source: RecordingSource; silent?: boolean };

/** Most note ids one bulk IPC call carries (the dashboard preload batches larger selections). */
export const MAX_BATCH = 500;

export const Ch = {
  // main → overlay
  RecorderStart: 'recorder:start', // { deviceId: string | null; source: RecordingSource; ping?: boolean; dictation?: { ping: boolean } }
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
  LaterDrop: 'later:drop', // DropPayload → 'saved' | 'ignored' (invoke)
  DictationAudio: 'dictation:audio', // DictationAudio
  PomodoroState: 'pomodoro:state', // Pomodoro: the overlay's timer, whenever it changes
  PomodoroDone: 'pomodoro:done', // { focusMs } a focus phase ran to the end
  PomodoroConfig: 'pomodoro:config', // main → overlay: PomodoroSettings
  PomodoroCommand: 'pomodoro:command', // dashboard → main (invoke) → overlay: { action }
  // dashboard ↔ main (invoke)
  NotesList: 'notes:list',
  NotesRename: 'notes:rename',
  NotesDelete: 'notes:delete',
  NotesReveal: 'notes:reveal',
  NotesFetchAudio: 'notes:fetch-audio', // id → FetchAudioResult (a remote note's audio from the account)
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
  DictationsList: 'dictations:list', // → Dictation[]
  DictationsCopy: 'dictations:copy', // { id } main writes the clipboard
  DictationsClear: 'dictations:clear',
  LocalStatus: 'local:status',
  LocalInstall: 'local:install',
  LocalCancel: 'local:cancel',
  LocalRemove: 'local:remove',
  LocalTest: 'local:test',
  AccountGet: 'account:get',
  AccountSignIn: 'account:sign-in',
  AccountCancel: 'account:cancel',
  AccountSignOut: 'account:sign-out',
  SyncGet: 'sync:get',
  SyncTurnOn: 'sync:turn-on',
  SyncTurnOff: 'sync:turn-off',
  SyncNow: 'sync:now',
  SyncDismissPrompt: 'sync:dismiss-prompt',
  ConnectorsGet: 'connectors:get',
  ConnectorsConnect: 'connectors:connect',
  ConnectorsCancel: 'connectors:cancel',
  ConnectorsDisconnect: 'connectors:disconnect',
  CalendarToday: 'calendar:today',
  CalendarRange: 'calendar:range',
  CalendarCreate: 'calendar:create',
  CalendarQuickAdd: 'calendar:quick-add',
  PomodoroGet: 'pomodoro:get', // → Pomodoro
  PomodoroSessions: 'pomodoro:sessions', // → PomodoroSession[]
  PomodoroClearSessions: 'pomodoro:clear-sessions',
  // main → dashboard
  PagesChanged: 'pages:changed',
  NotesChanged: 'notes:changed',
  SettingsChanged: 'settings:changed',
  FoldersChanged: 'folders:changed',
  DictationsChanged: 'dictations:changed',
  LocalChanged: 'local:changed', // LocalStatus (also download progress)
  AccountChanged: 'account:changed', // AccountInfo
  SyncChanged: 'sync:changed', // SyncView
  ConnectorsChanged: 'connectors:changed', // ConnectorsInfo
  PomodoroChanged: 'pomodoro:changed', // Pomodoro
  PomodoroSessionsChanged: 'pomodoro:sessions-changed',
  TranscriptionStatus: 'transcription:status', // StatusMap
  TranscriptionNeedWav: 'transcription:need-wav', // { requestId, bytes, mimeType } → answered on transcription:wav
} as const;

/** A voice note's transcription job; a note with no entry has none (or it finished). */
export type JobStatus = { state: 'queued' } | { state: 'running' } | { state: 'failed'; error: string };
export type StatusMap = Record<string, JobStatus>;
/** What the dashboard may know about the saved API key. */
export type KeyInfo = { saved: boolean; last4: string };
/** What the Account page shows about sync: the state, and whether to ask "Sync this PC with your account?". */
/** Bringing a remote note's audio to this PC: why it didn't work, for the toast. */
export type FetchAudioResult = { ok: true } | { ok: false; reason: 'not-uploaded' | 'offline' | 'sync-off' | 'error' };

/** filesWaiting: audio and images not uploaded yet; storageFull: the account refused the last upload for space. */
export type SyncView = { status: SyncStatus; needsPrompt: boolean; filesWaiting: number; storageFull: boolean };

/** This PC's sync, as the Account page shows it. */
export type SyncStatus =
  | { mode: 'off' }
  | { mode: 'paused'; reason: 'signed-out' }
  | { mode: 'idle'; lastSyncedAt: number | null }
  | { mode: 'syncing' }
  | { mode: 'offline'; retryAt: number }
  | { mode: 'error'; message: string };

/** Who is signed in, as the window sees it: never tokens. */
export type AccountInfo =
  | { state: 'signed-out'; error?: string }
  | { state: 'signing-in' }
  | { state: 'signed-in'; userId: string; email: string; name: string; avatar: string | null };

/** One Google Calendar event. Times are ms; an all-day event runs local midnight to midnight (end exclusive). */
export type CalendarEvent = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  link: string;
  location?: string;
  description?: string; // plain text as Google has it, at most 2000 characters
};

/** An event to add. For an all-day one, start and end are the local midnights of the first day and the day after the last. */
export type NewEvent = { title: string; allDay: boolean; start: number; end: number };

export type CalendarError = 'signed-out' | 'not-connected' | 'needs-reconnect' | 'offline' | 'failed';
export type RangeResult = { events: CalendarEvent[] } | { error: CalendarError };
export type AddResult = { event: CalendarEvent } | { error: CalendarError };

/** The Google Calendar connection as the window sees it: never tokens. */
export type ConnectorsInfo =
  | { state: 'signed-out' }
  | { state: 'disconnected'; error?: string }
  | { state: 'connecting' }
  | { state: 'connected'; email: string }
  | { state: 'needs-reconnect' };

/** What the Today's calendar card gets. */
export type TodayResult = RangeResult;

/** The built-in provider as the Transcription page shows it. */
export type LocalStatus = {
  available: boolean; // an engine build exists for this CPU
  engine: boolean;
  models: Record<ModelId, boolean>;
  recommended: ModelId;
  diskBytes: number;
  job: { modelId: ModelId; phase: 'engine' | 'model'; received: number; total: number } | null;
  runtimeMissing: boolean; // the Microsoft Visual C++ runtime the engine needs isn't installed
};

export type TestResult = { ok: true; ms: number; language: string | null } | { ok: false; error: string };
