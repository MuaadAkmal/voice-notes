import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, shell } from 'electron';
import log from 'electron-log/main';
import { z } from 'zod';
import {
  AppendEntrySchema,
  type AudioDevice,
  AudioPayloadSchema,
  Ch,
  DevicesSchema,
  DragSchema,
  OverlayTitleSchema,
  CreateFolderSchema,
  CreatePageSchema,
  ErrorSchema,
  ExternalUrlSchema,
  SaveImageSchema,
  SetBodySchema,
  IdListSchema,
  IdSchema,
  MoveFolderSchema,
  MoveNotesSchema,
  ProbeResultSchema,
  SetShowSchema,
  StarNotesSchema,
  RenameFolderSchema,
  PointerSchema,
  RenameSchema,
  type Settings,
  SettingsPatchSchema,
} from '../shared/ipc';
import { pruneWidgets } from '../shared/home-widgets';
import type { HotkeyService } from './hotkey/service';
import type { NoteStore } from './store/note-store';
import type { HotkeyGesture } from './hotkey/gesture';
import type { RecorderController } from './recorder/controller';

type OverlayDeps = {
  overlay: BrowserWindow;
  gesture: HotkeyGesture;
  controller: RecorderController;
  onDevices: (devices: AudioDevice[]) => void;
  onDragEnd: () => void;
  titles: { start(): void; submit(noteId: string, title: string): void; cancel(): void };
  onFilmError: (message: string) => void;
  onProbeResult: (id: number, playing: boolean) => void;
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

export function registerOverlayIpc(deps: OverlayDeps): void {
  const { overlay, gesture, controller, onDevices, onDragEnd, titles } = deps;
  ipcMain.on(Ch.FilmError, from(overlay, ErrorSchema, ({ message }) => deps.onFilmError(message)));
  ipcMain.on(
    Ch.FilmAudio,
    from(overlay, AudioPayloadSchema, (a) => {
      const bytes = Buffer.from(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength);
      controller.onRewindAudio({ bytes, durationMs: a.durationMs, mimeType: a.mimeType, source: a.source }).catch((e) => log.error(e));
    }),
  );
  ipcMain.on(Ch.FilmSaveError, from(overlay, ErrorSchema, ({ message }) => controller.onRewindError(message)));
  ipcMain.on(Ch.MediaProbeResult, from(overlay, ProbeResultSchema, ({ id, playing }) => deps.onProbeResult(id, playing)));
  ipcMain.on(Ch.OverlayTitleStart, (e) => e.sender === overlay.webContents && titles.start());
  ipcMain.on(Ch.OverlayTitle, from(overlay, OverlayTitleSchema, ({ noteId, title }) => titles.submit(noteId, title)));
  ipcMain.on(Ch.OverlayTitleCancel, (e) => e.sender === overlay.webContents && titles.cancel());
  ipcMain.on(Ch.OverlayDiscard, (e) => e.sender === overlay.webContents && gesture.escape());
  ipcMain.on(
    Ch.OverlayDrag,
    from(overlay, DragSchema, ({ dx, dy }) => {
      const [x, y] = overlay.getPosition();
      overlay.setPosition(x + dx, y + dy);
    }),
  );
  ipcMain.on(Ch.OverlayDragEnd, (e) => e.sender === overlay.webContents && onDragEnd());
  ipcMain.on(Ch.OverlayDevices, from(overlay, DevicesSchema, onDevices));
  ipcMain.on(
    Ch.RecorderAudio,
    from(overlay, AudioPayloadSchema, (a) => {
      const bytes = Buffer.from(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength);
      controller.onAudio({ bytes, durationMs: a.durationMs, mimeType: a.mimeType, source: a.source }).catch((e) => log.error(e));
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
    from(overlay, PointerSchema, ({ over }) => {
      overlay.setIgnoreMouseEvents(!over, { forward: true });
      // Hovering a "Saved" pill keeps it up long enough to click "Add title".
      if (over) controller.pauseFlash();
      else controller.resumeFlash();
    }),
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
  foldersChanged: () => void;
  pagesChanged: () => void;
  /** Test hook: URLs the OpenExternal handler would have opened. */
  openedExternal: string[];
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

  handle(Ch.NotesMove, MoveNotesSchema, ({ ids, folderId }) => {
    d.store.moveNotes(ids, folderId);
    d.notesChanged();
  });
  handle(Ch.NotesStar, StarNotesSchema, ({ ids, starred }) => {
    d.store.setStarred(ids, starred);
    d.notesChanged();
  });
  handle(Ch.NotesSetShow, SetShowSchema, ({ id, show }) => {
    const note = d.store.setShow(id, show);
    d.notesChanged();
    return note;
  });
  handle(Ch.NotesDeleteMany, IdListSchema, async (ids) => {
    await d.store.deleteMany(ids);
    d.notesChanged();
  });

  // Folder mutations can change note and page placement and counts, so all views refresh.
  const folderMutation = <T>(fn: () => T): T => {
    const result = fn();
    d.foldersChanged();
    d.notesChanged();
    d.pagesChanged();
    return result;
  };

  const pages = d.store.pages;
  handle(Ch.PagesList, none, () => pages.list());
  handle(Ch.PagesCreate, CreatePageSchema, ({ folderId }) => {
    const page = pages.create(folderId);
    d.pagesChanged();
    return page;
  });
  handle(Ch.PagesRename, RenameSchema, ({ id, title }) => {
    const page = pages.rename(id, title);
    d.pagesChanged();
    return page;
  });
  handle(Ch.PagesSetBody, SetBodySchema, ({ id, body }) => {
    const page = pages.setBody(id, body);
    d.pagesChanged();
    return page;
  });
  handle(Ch.PagesAppendEntry, AppendEntrySchema, ({ id, text }) => {
    const page = pages.appendEntry(id, text);
    d.pagesChanged();
    return page;
  });
  handle(Ch.PagesMove, MoveNotesSchema, ({ ids, folderId }) => {
    pages.move(ids, folderId);
    d.pagesChanged();
  });
  handle(Ch.PagesStar, StarNotesSchema, ({ ids, starred }) => {
    pages.setStarred(ids, starred);
    d.pagesChanged();
  });
  handle(Ch.PagesDeleteMany, IdListSchema, async (ids) => {
    await pages.deleteMany(ids);
    // Widgets of deleted pages go too; updateSettings emits settings:changed.
    const current = d.getSettings().homeWidgets;
    const pruned = pruneWidgets(current, ids);
    if (pruned.length !== current.length) d.updateSettings({ homeWidgets: pruned });
    d.pagesChanged();
  });
  handle(Ch.PagesSaveImage, SaveImageSchema, ({ bytes, ext }) => pages.saveImage(bytes, ext));
  handle(Ch.OpenExternal, ExternalUrlSchema, async (url) => {
    const href = new URL(url).href;
    // Under test, only record: a real call would launch the developer's browser.
    if (process.env.VOICE_NOTES_TEST === '1') d.openedExternal.push(href);
    else await shell.openExternal(href);
  });
  const folders = d.store.folders;
  handle(Ch.FoldersList, none, () => folders.list());
  handle(Ch.FoldersCreate, CreateFolderSchema, ({ name, parentId }) =>
    folderMutation(() => folders.create(name, parentId)),
  );
  handle(Ch.FoldersRename, RenameFolderSchema, ({ id, name }) => folderMutation(() => folders.rename(id, name)));
  handle(Ch.FoldersMove, MoveFolderSchema, ({ id, parentId }) => folderMutation(() => folders.move(id, parentId)));
  handle(Ch.FoldersDelete, IdSchema, (id) => folderMutation(() => folders.delete(id)));
}
