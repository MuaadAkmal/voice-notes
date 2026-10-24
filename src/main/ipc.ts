import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, shell } from 'electron';
import log from 'electron-log/main';
import { z } from 'zod';
import {
  type AudioDevice,
  AudioPayloadSchema,
  Ch,
  DevicesSchema,
  ErrorSchema,
  IdSchema,
  PointerSchema,
  RenameSchema,
  type Settings,
  SettingsPatchSchema,
} from '../shared/ipc';
import type { HotkeyService } from './hotkey/service';
import type { NoteStore } from './store/note-store';
import type { HotkeyGesture } from './hotkey/gesture';
import type { RecorderController } from './recorder/controller';

type OverlayDeps = {
  overlay: BrowserWindow;
  gesture: HotkeyGesture;
  controller: RecorderController;
  onDevices: (devices: AudioDevice[]) => void;
};

/** Listener that only accepts messages from `win` whose payload matches `schema`. */
function from<S extends z.ZodType>(win: BrowserWindow, schema: S, handler: (payload: z.infer<S>) => void) {
  return (event: IpcMainEvent, payload: unknown) => {
    if (event.sender !== win.webContents) return;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      log.warn('[ipc] rejected payload', parsed.error.message);
      return;
    }
    handler(parsed.data);
  };
}

export function registerOverlayIpc({ overlay, gesture, controller, onDevices }: OverlayDeps): void {
  ipcMain.on(Ch.OverlayDevices, from(overlay, DevicesSchema, onDevices));
  ipcMain.on(
    Ch.RecorderAudio,
    from(overlay, AudioPayloadSchema, (a) => {
      const bytes = Buffer.from(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength);
      controller.onAudio({ bytes, durationMs: a.durationMs, mimeType: a.mimeType }).catch((e) => log.error(e));
    }),
  );
  ipcMain.on(
    Ch.RecorderError,
    from(overlay, ErrorSchema, ({ message }) => {
      log.warn('[recorder] capture error', message);
      controller.onCaptureError(message);
    }),
  );
  ipcMain.on(
    Ch.OverlayPointer,
    from(overlay, PointerSchema, ({ over }) => overlay.setIgnoreMouseEvents(!over, { forward: true })),
  );
  ipcMain.on(Ch.OverlayClick, (e) => e.sender === overlay.webContents && gesture.toggle());
  ipcMain.on(Ch.OverlayRetry, (e) => {
    if (e.sender === overlay.webContents) controller.retry().catch((err) => log.error(err));
  });
}

type DashboardDeps = {
  getDashboard: () => BrowserWindow | null;
  store: NoteStore;
  hotkey: HotkeyService;
  getSettings: () => Settings;
  updateSettings: (patch: Partial<Settings>) => Settings;
  getDevices: () => AudioDevice[];
  notesChanged: () => void;
};

export function registerDashboardIpc(d: DashboardDeps): void {
  /** invoke handler that only answers the dashboard window. */
  const handle = <S extends z.ZodType, R>(channel: string, schema: S, fn: (payload: z.infer<S>) => R) =>
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, payload: unknown) => {
      const win = d.getDashboard();
      if (!win || BrowserWindow.fromWebContents(event.sender) !== win) throw new Error('Forbidden');
      return fn(schema.parse(payload));
    });
  const none = z.undefined();

  handle(Ch.NotesList, none, () => d.store.list());
  handle(Ch.NotesRename, RenameSchema, ({ id, title }) => {
    const note = d.store.rename(id, title);
    d.notesChanged();
    return note;
  });
  handle(Ch.NotesDelete, IdSchema, async (id) => {
    await d.store.delete(id);
    d.notesChanged();
  });
  handle(Ch.NotesReveal, IdSchema, (id) => {
    const note = d.store.get(id);
    if (note?.status === 'ok') shell.showItemInFolder(d.store.absolutePath(note));
  });
  handle(Ch.SettingsGet, none, () => d.getSettings());
  handle(Ch.SettingsSet, SettingsPatchSchema, (patch) => d.updateSettings(patch));
  handle(Ch.HotkeyCapture, none, () => d.hotkey.captureCombo());
  handle(Ch.DevicesList, none, () => d.getDevices());
  handle(Ch.OpenRecordingsFolder, none, async () => {
    await shell.openPath(d.store.recordingsDir);
  });
}
