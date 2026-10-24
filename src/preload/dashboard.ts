import { contextBridge, ipcRenderer } from 'electron';
import { type AudioDevice, Ch, type Note, type Settings } from '../shared/channels';

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
  onNotesChanged: (cb: () => void) => subscribe(Ch.NotesChanged, cb),
  onSettingsChanged: (cb: () => void) => subscribe(Ch.SettingsChanged, cb),
};

export type DashboardApi = typeof dashboardApi;

contextBridge.exposeInMainWorld('dashboardApi', dashboardApi);
