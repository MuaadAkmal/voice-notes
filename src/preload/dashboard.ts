import { contextBridge, ipcRenderer } from 'electron';
import {
  type AudioDevice,
  Ch,
  type Dictation,
  type LocalStatus,
  type AccountInfo,
  type ConnectorsInfo,
  type TodayResult,
  type AddResult,
  type NewEvent,
  type RangeResult,
  type SyncView,
  type Folder,
  type KeyInfo,
  MAX_BATCH,
  type Note,
  type Page,
  type FetchAudioResult,
  type Settings,
  type StatusMap,
  type TestResult,
} from '../shared/channels';
import { chunk } from '../shared/format';
import type { ImageExt } from '../shared/page-images';
import type { ModelId, TranscribeLanguage } from '../shared/transcription';

const subscribe = (channel: string, cb: () => void) => {
  const listener = () => cb();
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
};

/** Like subscribe, for channels that carry a payload. */
const subscribeWith = <T>(channel: string, cb: (payload: T) => void) => {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
};

type WavRequest = { requestId: number; bytes: Uint8Array; mimeType: string };
type WavReply = { requestId: number; bytes: Uint8Array } | { requestId: number; error: string };

const dashboardApi = {
  listNotes: (): Promise<Note[]> => ipcRenderer.invoke(Ch.NotesList),
  renameNote: (id: string, title: string): Promise<Note> => ipcRenderer.invoke(Ch.NotesRename, { id, title }),
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke(Ch.NotesDelete, id),
  revealNote: (id: string): Promise<void> => ipcRenderer.invoke(Ch.NotesReveal, id),
  fetchAudio: (id: string): Promise<FetchAudioResult> => ipcRenderer.invoke(Ch.NotesFetchAudio, id),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(Ch.SettingsGet),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(Ch.SettingsSet, patch),
  captureHotkey: (): Promise<{ keycodes: number[]; label: string }> => ipcRenderer.invoke(Ch.HotkeyCapture),
  listDevices: (): Promise<AudioDevice[]> => ipcRenderer.invoke(Ch.DevicesList),
  openRecordingsFolder: (): Promise<void> => ipcRenderer.invoke(Ch.OpenRecordingsFolder),
  // Main caps each call at MAX_BATCH ids; larger selections go in sequential batches.
  moveNotes: async (ids: string[], folderId: string | null): Promise<void> => {
    for (const batch of chunk(ids, MAX_BATCH)) await ipcRenderer.invoke(Ch.NotesMove, { ids: batch, folderId });
  },
  deleteNotes: async (ids: string[]): Promise<void> => {
    for (const batch of chunk(ids, MAX_BATCH)) await ipcRenderer.invoke(Ch.NotesDeleteMany, batch);
  },
  starNotes: async (ids: string[], starred: boolean): Promise<void> => {
    for (const batch of chunk(ids, MAX_BATCH)) await ipcRenderer.invoke(Ch.NotesStar, { ids: batch, starred });
  },
  setShow: (id: string, show: string | null): Promise<Note> => ipcRenderer.invoke(Ch.NotesSetShow, { id, show }),
  listFolders: (): Promise<Folder[]> => ipcRenderer.invoke(Ch.FoldersList),
  createFolder: (name: string, parentId: string | null): Promise<Folder> =>
    ipcRenderer.invoke(Ch.FoldersCreate, { name, parentId }),
  renameFolder: (id: string, name: string): Promise<Folder> => ipcRenderer.invoke(Ch.FoldersRename, { id, name }),
  moveFolder: (id: string, parentId: string | null): Promise<Folder> =>
    ipcRenderer.invoke(Ch.FoldersMove, { id, parentId }),
  deleteFolder: (id: string): Promise<void> => ipcRenderer.invoke(Ch.FoldersDelete, id),
  listPages: (): Promise<Page[]> => ipcRenderer.invoke(Ch.PagesList),
  createPage: (folderId: string | null): Promise<Page> => ipcRenderer.invoke(Ch.PagesCreate, { folderId }),
  renamePage: (id: string, title: string): Promise<Page> => ipcRenderer.invoke(Ch.PagesRename, { id, title }),
  /** `expected`: the text this edit started from; if the page changed since, the other text is kept as a copy. */
  setPageBody: (id: string, body: string, expected?: string): Promise<Page> =>
    ipcRenderer.invoke(Ch.PagesSetBody, { id, body, expected }),
  appendPageEntry: (id: string, text: string): Promise<Page> =>
    ipcRenderer.invoke(Ch.PagesAppendEntry, { id, text }),
  setPageTask: (id: string, line: number, checked: boolean): Promise<Page> =>
    ipcRenderer.invoke(Ch.PagesSetTask, { id, line, checked }),
  movePages: async (ids: string[], folderId: string | null): Promise<void> => {
    for (const batch of chunk(ids, MAX_BATCH)) await ipcRenderer.invoke(Ch.PagesMove, { ids: batch, folderId });
  },
  starPages: async (ids: string[], starred: boolean): Promise<void> => {
    for (const batch of chunk(ids, MAX_BATCH)) await ipcRenderer.invoke(Ch.PagesStar, { ids: batch, starred });
  },
  deletePages: async (ids: string[]): Promise<void> => {
    for (const batch of chunk(ids, MAX_BATCH)) await ipcRenderer.invoke(Ch.PagesDeleteMany, batch);
  },
  savePageImage: (bytes: Uint8Array, ext: ImageExt): Promise<string> =>
    ipcRenderer.invoke(Ch.PagesSaveImage, { bytes, ext }),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(Ch.OpenExternal, url),
  setTranscript: (id: string, text: string): Promise<Note> => ipcRenderer.invoke(Ch.NotesSetTranscript, { id, text }),
  getTranscriptionStatus: (): Promise<StatusMap> => ipcRenderer.invoke(Ch.TranscriptionGetStatus),
  transcribeNotes: async (ids: string[], language: TranscribeLanguage): Promise<void> => {
    for (const batch of chunk(ids, MAX_BATCH)) await ipcRenderer.invoke(Ch.TranscriptionEnqueue, { ids: batch, language });
  },
  testTranscription: (baseUrl: string, model: string): Promise<TestResult> =>
    ipcRenderer.invoke(Ch.TranscriptionTest, { baseUrl, model }),
  getKeyInfo: (): Promise<KeyInfo> => ipcRenderer.invoke(Ch.TranscriptionKeyInfo),
  setKey: (key: string): Promise<KeyInfo> => ipcRenderer.invoke(Ch.TranscriptionSetKey, { key }),
  removeKey: (): Promise<KeyInfo> => ipcRenderer.invoke(Ch.TranscriptionRemoveKey),
  sendWav: (reply: WavReply): Promise<void> => ipcRenderer.invoke(Ch.TranscriptionWav, reply),
  onTranscriptionStatus: (cb: (status: StatusMap) => void) => subscribeWith(Ch.TranscriptionStatus, cb),
  onNeedWav: (cb: (req: WavRequest) => void) => subscribeWith(Ch.TranscriptionNeedWav, cb),
  listDictations: (): Promise<Dictation[]> => ipcRenderer.invoke(Ch.DictationsList),
  copyDictation: (id: string): Promise<void> => ipcRenderer.invoke(Ch.DictationsCopy, { id }),
  clearDictations: (): Promise<void> => ipcRenderer.invoke(Ch.DictationsClear),
  onDictationsChanged: (cb: () => void) => subscribe(Ch.DictationsChanged, cb),
  localStatus: (): Promise<LocalStatus> => ipcRenderer.invoke(Ch.LocalStatus),
  installLocal: (modelId: ModelId): Promise<void> => ipcRenderer.invoke(Ch.LocalInstall, { modelId }),
  cancelLocal: (): Promise<void> => ipcRenderer.invoke(Ch.LocalCancel),
  removeLocal: (modelId: ModelId, engineToo?: boolean): Promise<void> =>
    ipcRenderer.invoke(Ch.LocalRemove, { modelId, engineToo }),
  testLocal: (): Promise<TestResult> => ipcRenderer.invoke(Ch.LocalTest),
  onLocalChanged: (cb: (status: LocalStatus) => void) => subscribeWith(Ch.LocalChanged, cb),
  getAccount: (): Promise<AccountInfo> => ipcRenderer.invoke(Ch.AccountGet),
  signIn: (): Promise<void> => ipcRenderer.invoke(Ch.AccountSignIn),
  cancelSignIn: (): Promise<void> => ipcRenderer.invoke(Ch.AccountCancel),
  signOut: (): Promise<void> => ipcRenderer.invoke(Ch.AccountSignOut),
  onAccountChanged: (cb: (info: AccountInfo) => void) => subscribeWith(Ch.AccountChanged, cb),
  getSync: (): Promise<SyncView> => ipcRenderer.invoke(Ch.SyncGet),
  turnOnSync: (): Promise<void> => ipcRenderer.invoke(Ch.SyncTurnOn),
  turnOffSync: (): Promise<void> => ipcRenderer.invoke(Ch.SyncTurnOff),
  syncNow: (): Promise<void> => ipcRenderer.invoke(Ch.SyncNow),
  dismissSyncPrompt: (): Promise<void> => ipcRenderer.invoke(Ch.SyncDismissPrompt),
  onSyncChanged: (cb: (view: SyncView) => void) => subscribeWith(Ch.SyncChanged, cb),
  getConnectors: (): Promise<ConnectorsInfo> => ipcRenderer.invoke(Ch.ConnectorsGet),
  connectGoogle: (): Promise<void> => ipcRenderer.invoke(Ch.ConnectorsConnect),
  cancelConnect: (): Promise<void> => ipcRenderer.invoke(Ch.ConnectorsCancel),
  disconnectGoogle: (): Promise<void> => ipcRenderer.invoke(Ch.ConnectorsDisconnect),
  calendarToday: (): Promise<TodayResult> => ipcRenderer.invoke(Ch.CalendarToday),
  calendarRange: (from: number, to: number): Promise<RangeResult> => ipcRenderer.invoke(Ch.CalendarRange, { from, to }),
  createEvent: (e: NewEvent): Promise<AddResult> => ipcRenderer.invoke(Ch.CalendarCreate, e),
  quickAddEvent: (text: string): Promise<AddResult> => ipcRenderer.invoke(Ch.CalendarQuickAdd, { text }),
  onConnectorsChanged: (cb: (info: ConnectorsInfo) => void) => subscribeWith(Ch.ConnectorsChanged, cb),
  onPagesChanged: (cb: () => void) => subscribe(Ch.PagesChanged, cb),
  onNotesChanged: (cb: () => void) => subscribe(Ch.NotesChanged, cb),
  onFoldersChanged: (cb: () => void) => subscribe(Ch.FoldersChanged, cb),
  onSettingsChanged: (cb: () => void) => subscribe(Ch.SettingsChanged, cb),
};

export type DashboardApi = typeof dashboardApi;

contextBridge.exposeInMainWorld('dashboardApi', dashboardApi);
