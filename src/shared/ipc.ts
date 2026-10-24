import { z } from 'zod';

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

export type AudioPayload = { bytes: ArrayBuffer; durationMs: number; mimeType: string };

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

export const SettingsFieldSchemas = {
  hotkey: z.array(z.number().int().nonnegative()).min(1).max(4),
  hotkeyLabel: z.string().min(1).max(60),
  micDeviceId: z.string().max(512).nullable(),
  launchAtLogin: z.boolean(),
  showIdlePill: z.boolean(),
  hotkeyPaused: z.boolean(),
} satisfies { [K in keyof Settings]: z.ZodType<Settings[K]> };

export const SettingsPatchSchema = z.object(SettingsFieldSchemas).partial().strict();

export const AudioPayloadSchema = z.object({
  bytes: z.instanceof(ArrayBuffer),
  durationMs: z.number().nonnegative().finite(),
  mimeType: z.string().min(1).max(100),
});

export const IdSchema = z.uuid();
export const RenameSchema = z.object({ id: IdSchema, title: z.string().trim().min(1).max(200) });
export const PointerSchema = z.object({ over: z.boolean() });
export const ErrorSchema = z.object({ message: z.string().max(200) });
