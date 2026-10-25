import { contextBridge, ipcRenderer } from 'electron';
import { type AudioDevice, Ch, type Folder, MAX_BATCH, type Note, type Page, type Settings } from '../shared/channels';
import { chunk } from '../shared/format';
import type { ImageExt } from '../shared/page-images';

const subscribe = (channel: string, cb: () => void) => {
  const listener = () => cb();
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
};

const dashboardApi = {
  listNotes: (): Promise<Note[]> => ipcRenderer.invoke(Ch.NotesList),
  renameNote: (id: string, title: string): Promise<Note> => ipcRenderer.invoke(Ch.NotesRename, { id, title }),
  deleteNote: (id: string): Promise<void> => ipcRenderer.invoke(Ch.NotesDelete, id),
  revealNote: (id: string): Promise<void> => ipcRenderer.invoke(Ch.NotesReveal, id),
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
  setPageBody: (id: string, body: string): Promise<Page> => ipcRenderer.invoke(Ch.PagesSetBody, { id, body }),
  appendPageEntry: (id: string, text: string): Promise<Page> =>
    ipcRenderer.invoke(Ch.PagesAppendEntry, { id, text }),
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
  onPagesChanged: (cb: () => void) => subscribe(Ch.PagesChanged, cb),
  onNotesChanged: (cb: () => void) => subscribe(Ch.NotesChanged, cb),
  onFoldersChanged: (cb: () => void) => subscribe(Ch.FoldersChanged, cb),
  onSettingsChanged: (cb: () => void) => subscribe(Ch.SettingsChanged, cb),
};

export type DashboardApi = typeof dashboardApi;

contextBridge.exposeInMainWorld('dashboardApi', dashboardApi);
