import { BrowserWindow, clipboard, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, shell } from 'electron';
import log from 'electron-log/main';
import { z } from 'zod';
import {
  type CaptureResult,
  AppendEntrySchema,
  type AudioDevice,
  AudioPayloadSchema,
  Ch,
  DevicesSchema,
  DragSchema,
  type DropPayload,
  type FetchAudioResult,
  DropPayloadSchema,
  OverlayTitleSchema,
  CreateFolderSchema,
  CreatePageSchema,
  CopyDictationSchema,
  DictationAudioSchema,
  ErrorSchema,
  ExternalUrlSchema,
  SaveImageSchema,
  SetBodySchema,
  SetTaskSchema,
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
  SetKeySchema,
  SetTranscriptSchema,
  LocalInstallSchema,
  LocalRemoveSchema,
  TranscriptionEnqueueSchema,
  TranscriptionTestSchema,
  WavReplySchema,
  NewEventSchema,
  type PomodoroAction,
  PomodoroCommandSchema,
  PomodoroDoneSchema,
  PomodoroSchema,
  type PomodoroSession,
  QuickAddSchema,
  ReminderIdSchema,
  ReminderTextSchema,
  ReminderUpdateSchema,
  RangeSchema,
} from '../shared/ipc';
import { normaliseBaseUrl } from '../shared/transcription';
import { pruneWidgets } from '../shared/home-widgets';
import type { Pomodoro } from '../shared/pomodoro';
import type { HotkeyService } from './hotkey/service';
import type { DictationController } from './dictation/controller';
import type { NoteStore } from './store/note-store';
import type { HotkeyGesture } from './hotkey/gesture';
import type { OverlayMouse } from './overlay-mouse';
import type { RecorderController } from './recorder/controller';
import type { AccountService } from './account/account';
import type { ConnectorsService } from './connectors/service';
import type { SyncController } from './sync/controller';
import { type FileSync, fetchFailure } from './sync/files';
import type { LocalWhisper } from './local-whisper';
import type { CloudAsrClient } from './transcription/cloud-client';
import { NotSignedIn, Offline } from './sync/http-server';
import type { CloudUsageResult } from '../shared/channels';
import type { Secrets } from './transcription/secrets';
import type { TranscriptionService } from './transcription/service';
import type { WavBridge } from './transcription/wav-bridge';
import type { RemindersService } from './reminders/service';
import { isReminder } from '../shared/reminder-command';

type OverlayDeps = {
  overlay: BrowserWindow;
  overlayMouse: OverlayMouse; // hover and drags share the window's click-through flag
  gesture: HotkeyGesture;
  controller: RecorderController;
  dictation: DictationController;
  dictationGesture: HotkeyGesture;
  onDevices: (devices: AudioDevice[]) => void;
  onDragEnd: () => void;
  titles: { start(): void; submit(noteId: string, title: string): void; cancel(): void };
  onFilmError: (message: string) => void;
  onProbeResult: (id: number, playing: boolean) => void;
  onDrop: (payload: DropPayload) => 'saved' | 'ignored'; // throws when saving fails
  onCaptureLater: () => Promise<CaptureResult>; // throws when saving fails
  onPomodoro: (timer: Pomodoro) => void;
  onPomodoroDone: (focusMs: number) => void;
};

/** Listener that only accepts messages from `win` whose payload matches `schema`. */
/** Whether a message came from `win`; a destroyed window's webContents can't even be read. */
const isFrom = (win: BrowserWindow, sender: Electron.WebContents) => !win.isDestroyed() && sender === win.webContents;

function from<S extends z.ZodType>(win: BrowserWindow, schema: S, handler: (payload: z.infer<S>) => void) {
  return (event: IpcMainEvent, payload: unknown) => {
    if (!isFrom(win, event.sender)) return;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      log.warn('[ipc] rejected payload', parsed.error.message);
      return;
    }
    handler(parsed.data);
  };
}

export function registerOverlayIpc(deps: OverlayDeps): void {
  const { overlay, gesture, controller, dictation, dictationGesture, onDevices, onDragEnd, titles } = deps;
  ipcMain.on(Ch.FilmError, from(overlay, ErrorSchema, ({ message }) => deps.onFilmError(message)));
  ipcMain.on(
    Ch.FilmAudio,
    from(overlay, AudioPayloadSchema, (a) => {
      const bytes = Buffer.from(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength);
      controller.onRewindAudio({ bytes, durationMs: a.durationMs, mimeType: a.mimeType, source: a.source }).catch((e) => log.error(e));
    }),
  );
  ipcMain.on(Ch.FilmSaveError, from(overlay, ErrorSchema, ({ message }) => controller.onRewindError(message)));
  ipcMain.on(Ch.PomodoroState, from(overlay, PomodoroSchema, deps.onPomodoro));
  ipcMain.on(Ch.PomodoroDone, from(overlay, PomodoroDoneSchema, ({ focusMs }) => deps.onPomodoroDone(focusMs)));
  ipcMain.on(Ch.MediaProbeResult, from(overlay, ProbeResultSchema, ({ id, playing }) => deps.onProbeResult(id, playing)));
  ipcMain.on(Ch.OverlayTitleStart, (e) => isFrom(overlay, e.sender) && titles.start());
  ipcMain.on(Ch.OverlayTitle, from(overlay, OverlayTitleSchema, ({ noteId, title }) => titles.submit(noteId, title)));
  ipcMain.on(Ch.OverlayTitleCancel, (e) => isFrom(overlay, e.sender) && titles.cancel());
  // The hands-free × discards whichever is recording (only one can be).
  ipcMain.on(Ch.OverlayDiscard, (e) => {
    if (!isFrom(overlay, e.sender)) return;
    gesture.escape();
    dictationGesture.escape();
  });
  ipcMain.on(
    Ch.OverlayDrag,
    from(overlay, DragSchema, ({ dx, dy }) => {
      const [x, y] = overlay.getPosition();
      overlay.setPosition(x + dx, y + dy);
    }),
  );
  ipcMain.on(Ch.OverlayDragEnd, (e) => isFrom(overlay, e.sender) && onDragEnd());
  ipcMain.on(Ch.OverlayDevices, from(overlay, DevicesSchema, onDevices));
  ipcMain.on(
    Ch.RecorderAudio,
    from(overlay, AudioPayloadSchema, (a) => {
      const bytes = Buffer.from(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength);
      controller
        .onAudio({ bytes, durationMs: a.durationMs, mimeType: a.mimeType, source: a.source }, { silent: a.silent })
        .catch((e) => log.error(e));
    }),
  );
  ipcMain.on(
    Ch.RecorderError,
    from(overlay, ErrorSchema, ({ message }) => {
      log.warn('[recorder] capture error', message);
      if (dictation.active) dictation.onCaptureError(message);
      else controller.onCaptureError(message);
    }),
  );
  ipcMain.on(
    Ch.OverlayPointer,
    from(overlay, PointerSchema, ({ over }) => {
      deps.overlayMouse.setHover(over);
      // Hovering a "Saved" pill keeps it up long enough to click "Add title".
      if (over) controller.pauseFlash();
      else controller.resumeFlash();
    }),
  );
  ipcMain.handle(Ch.LaterDrop, (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!isFrom(overlay, event.sender)) throw new Error('Forbidden');
    return deps.onDrop(DropPayloadSchema.parse(payload));
  });
  ipcMain.handle(Ch.LaterCapture, (event: IpcMainInvokeEvent) => {
    if (!isFrom(overlay, event.sender)) throw new Error('Forbidden');
    return deps.onCaptureLater();
  });
  ipcMain.on(
    Ch.DictationAudio,
    from(overlay, DictationAudioSchema, (a) => {
      dictation.onAudio(a).catch((e) => log.error('[dictation]', e));
    }),
  );
  // Clicking the pill during a dictation stops it; otherwise it toggles a hands-free note.
  ipcMain.on(Ch.OverlayClick, (e) => {
    if (!isFrom(overlay, e.sender)) return;
    if (dictation.active) dictationGesture.toggle();
    else gesture.toggle();
  });
  ipcMain.on(Ch.OverlayRetry, (e) => {
    if (isFrom(overlay, e.sender)) controller.retry().catch((err) => log.error(err));
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
  dictationsChanged: () => void;
  /** Test hook: URLs the OpenExternal handler would have opened. */
  openedExternal: string[];
  transcription: TranscriptionService;
  cloud: Pick<CloudAsrClient, 'usage'>;
  secrets: Secrets;
  wavBridge: WavBridge;
  localWhisper: LocalWhisper;
  account: AccountService;
  sync: SyncController;
  connectors: ConnectorsService;
  reminders: RemindersService;
  files: Pick<FileSync, 'fetchAudio'>;
  /** The timer lives in the overlay; main keeps its last state and passes commands on. */
  pomodoro: { get(): Pomodoro; command(action: PomodoroAction): void; sessions(): PomodoroSession[]; clear(): void };
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
  handle(Ch.NotesFetchAudio, IdSchema, async (id): Promise<FetchAudioResult> => {
    try {
      await d.files.fetchAudio(id);
      return { ok: true };
    } catch (err) {
      log.warn('[sync] audio download failed', err);
      return { ok: false, reason: fetchFailure(err) };
    }
  });
  handle(Ch.SettingsGet, none, () => d.getSettings());
  handle(Ch.SettingsSet, SettingsPatchSchema, (patch) => {
    // The built-in provider only with a downloaded model: anything else would fail every job.
    const t = patch.transcription;
    if (t?.provider === 'local') {
      const st = d.localWhisper.status();
      if (!(st.engine && t.localModel && st.models[t.localModel])) return d.getSettings();
    }
    return d.updateSettings(patch);
  });
  handle(Ch.PomodoroGet, none, () => d.pomodoro.get());
  handle(Ch.PomodoroCommand, PomodoroCommandSchema, ({ action }) => d.pomodoro.command(action));
  handle(Ch.PomodoroSessions, none, () => d.pomodoro.sessions());
  handle(Ch.PomodoroClearSessions, none, () => d.pomodoro.clear());
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
  handle(Ch.PagesSetBody, SetBodySchema, ({ id, body, expected }) => {
    const page = pages.setBody(id, body, expected);
    d.pagesChanged();
    return page;
  });
  handle(Ch.PagesAppendEntry, AppendEntrySchema, ({ id, text }) => {
    const page = pages.appendEntry(id, text);
    d.pagesChanged();
    return page;
  });
  handle(Ch.PagesSetTask, SetTaskSchema, ({ id, line, checked }) => {
    const page = pages.setTask(id, line, checked);
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
  handle(Ch.PagesDeleteMany, IdListSchema, async (requested) => {
    // The built-in Review later and Quick notes pages can't be deleted, whatever the renderer asks.
    const { laterPageId, notesPageId } = d.getSettings();
    const ids = requested.filter((id) => id !== laterPageId && id !== notesPageId);
    try {
      await pages.deleteMany(ids);
    } finally {
      // The rows are gone even if removing an image file threw, so prune and notify regardless.
      // Widgets of deleted pages go too; updateSettings emits settings:changed.
      const current = d.getSettings().homeWidgets;
      const pruned = pruneWidgets(current, ids);
      if (pruned.length !== current.length) d.updateSettings({ homeWidgets: pruned });
      d.pagesChanged();
    }
  });
  handle(Ch.PagesSaveImage, SaveImageSchema, ({ bytes, ext }) => pages.saveImage(bytes, ext));
  handle(Ch.OpenExternal, ExternalUrlSchema, async (url) => {
    const href = new URL(url).href;
    // Under test, only record: a real call would launch the developer's browser.
    if (process.env.VOICE_NOTES_TEST === '1') d.openedExternal.push(href);
    else await shell.openExternal(href);
  });
  handle(Ch.NotesSetTranscript, SetTranscriptSchema, ({ id, text }) => {
    const note = d.store.editTranscript(id, text);
    d.notesChanged();
    return note;
  });
  handle(Ch.TranscriptionGetStatus, none, () => d.transcription.status());
  handle(Ch.TranscriptionEnqueue, TranscriptionEnqueueSchema, ({ ids, language }) =>
    d.transcription.enqueue(ids, language),
  );
  handle(Ch.TranscriptionTest, TranscriptionTestSchema, ({ baseUrl, model }) =>
    // The schema already rejected URLs that don't normalise.
    d.transcription.test(normaliseBaseUrl(baseUrl) ?? baseUrl, model),
  );
  handle(Ch.TranscriptionKeyInfo, none, () => d.secrets.info('server'));
  handle(Ch.TranscriptionSetKey, SetKeySchema, ({ key }) => {
    d.secrets.set('server', key);
    return d.secrets.info('server');
  });
  handle(Ch.TranscriptionRemoveKey, none, () => {
    d.secrets.remove('server');
    return d.secrets.info('server');
  });
  handle(Ch.TranscriptionWav, WavReplySchema, (reply) => d.wavBridge.settle(reply.requestId, reply));
  handle(Ch.LocalStatus, none, () => d.localWhisper.status());
  handle(Ch.LocalInstall, LocalInstallSchema, ({ modelId }) => d.localWhisper.install(modelId));
  handle(Ch.LocalCancel, none, () => d.localWhisper.cancel());
  handle(Ch.LocalRemove, LocalRemoveSchema, async ({ modelId, engineToo }) => {
    try {
      await d.localWhisper.remove(modelId, engineToo);
    } finally {
      // Even a removal that failed half-way may have taken the active model's files.
      const t = d.getSettings().transcription;
      const st = d.localWhisper.status();
      if (t.provider === 'local' && !(st.engine && t.localModel && st.models[t.localModel]))
        d.updateSettings({ transcription: { ...t, provider: null } });
    }
  });
  handle(Ch.LocalTest, none, () => d.transcription.testCurrent());
  handle(Ch.TranscriptionCloudUsage, none, async (): Promise<CloudUsageResult> => {
    try {
      return await d.cloud.usage();
    } catch (e) {
      if (e instanceof NotSignedIn) return { error: 'signed-out' };
      if (e instanceof Offline) return { error: 'offline' };
      throw e;
    }
  });
  handle(Ch.AccountGet, none, () => d.account.current());
  handle(Ch.AccountSignIn, none, () => d.account.signIn());
  handle(Ch.AccountCancel, none, () => d.account.cancel());
  handle(Ch.AccountSignOut, none, () => d.account.signOut());
  handle(Ch.SyncGet, none, () => d.sync.view());
  handle(Ch.SyncTurnOn, none, () => {
    const info = d.account.current();
    if (info.state !== 'signed-in') throw new Error('Sign in first');
    d.sync.turnOn(info.userId);
  });
  handle(Ch.SyncTurnOff, none, () => d.sync.turnOff());
  handle(Ch.SyncNow, none, () => d.sync.syncNow());
  handle(Ch.SyncDismissPrompt, none, () => d.sync.dismissPrompt());
  handle(Ch.ConnectorsGet, none, () => d.connectors.current());
  handle(Ch.ConnectorsConnect, none, () => d.connectors.connect());
  handle(Ch.ConnectorsCancel, none, () => d.connectors.cancel());
  handle(Ch.ConnectorsDisconnect, none, () => d.connectors.disconnect());
  handle(Ch.CalendarToday, none, () => d.connectors.today(new Date()));
  handle(Ch.CalendarRange, RangeSchema, ({ from, to }) => d.connectors.range(new Date(from), new Date(to)));
  handle(Ch.CalendarCreate, NewEventSchema, (e) => d.connectors.create(e));
  handle(Ch.CalendarQuickAdd, QuickAddSchema, ({ text }) => d.connectors.quickAdd(text));
  handle(Ch.RemindersList, none, () => d.reminders.list());
  // Typed, "remind me" is optional: "call mom in 10 min" is a reminder too.
  handle(Ch.RemindersAdd, ReminderTextSchema, async ({ text }) => {
    const r = await d.reminders.add(isReminder(text) ? text : `remind me to ${text}`);
    return r ? { ok: r.reminder !== undefined, message: r.message } : { ok: false, message: 'Not a reminder' };
  });
  handle(Ch.RemindersUpdate, ReminderUpdateSchema, ({ id, ...patch }) => d.reminders.update(id, patch));
  handle(Ch.RemindersSnooze, ReminderIdSchema, ({ id }) => d.reminders.snooze(id));
  handle(Ch.RemindersDone, ReminderIdSchema, ({ id }) => d.reminders.done(id));
  handle(Ch.RemindersCancel, ReminderIdSchema, ({ id }) => d.reminders.cancel(id));
  const dictations = d.store.dictations;
  handle(Ch.DictationsList, none, () => dictations.list());
  // Main writes the clipboard: the dashboard has no clipboard permission.
  handle(Ch.DictationsCopy, CopyDictationSchema, async ({ id }) => {
    const entry = dictations.get(id);
    if (!entry) throw new Error('Dictation not found');
    await clipboard.writeText(entry.text);
  });
  handle(Ch.DictationsClear, none, () => {
    dictations.clear();
    d.dictationsChanged();
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
