import { contextBridge, ipcRenderer } from 'electron';
import {
  type AudioDevice,
  type AudioPayload,
  Ch,
  type DictationAudio,
  type DropPayload,
  type OverlayState,
  type RecordingSource,
} from '../shared/channels';

const on = <T>(channel: string, cb: (payload: T) => void) => {
  ipcRenderer.on(channel, (_e, payload: T) => cb(payload));
};

const overlayApi = {
  onStart: (cb: (p: { deviceId: string | null; source: RecordingSource; dictation?: { ping: boolean } }) => void) =>
    on(Ch.RecorderStart, cb),
  onStop: (cb: () => void) => on(Ch.RecorderStop, cb),
  onCancel: (cb: () => void) => on(Ch.RecorderCancel, cb),
  onState: (cb: (s: OverlayState) => void) => on(Ch.OverlayState, cb),
  sendAudio: (a: AudioPayload) => ipcRenderer.send(Ch.RecorderAudio, a),
  sendDictationAudio: (a: DictationAudio) => ipcRenderer.send(Ch.DictationAudio, a),
  sendError: (message: string) => ipcRenderer.send(Ch.RecorderError, { message }),
  setPointerOver: (over: boolean) => ipcRenderer.send(Ch.OverlayPointer, { over }),
  click: () => ipcRenderer.send(Ch.OverlayClick),
  retry: () => ipcRenderer.send(Ch.OverlayRetry),
  sendDevices: (devices: AudioDevice[]) => ipcRenderer.send(Ch.OverlayDevices, devices),
  drag: (dx: number, dy: number) => ipcRenderer.send(Ch.OverlayDrag, { dx, dy }),
  dragEnd: () => ipcRenderer.send(Ch.OverlayDragEnd),
  startTitle: () => ipcRenderer.send(Ch.OverlayTitleStart),
  submitTitle: (noteId: string, title: string) => ipcRenderer.send(Ch.OverlayTitle, { noteId, title }),
  cancelTitle: () => ipcRenderer.send(Ch.OverlayTitleCancel),
  discard: () => ipcRenderer.send(Ch.OverlayDiscard),
  onFilmMode: (cb: (p: { on: boolean }) => void) => on(Ch.FilmMode, cb),
  onFilmSave: (cb: (p: { seconds: number }) => void) => on(Ch.FilmSave, cb),
  sendFilmError: (message: string) => ipcRenderer.send(Ch.FilmError, { message }),
  sendRewindAudio: (a: AudioPayload) => ipcRenderer.send(Ch.FilmAudio, a),
  sendRewindError: (message: string) => ipcRenderer.send(Ch.FilmSaveError, { message }),
  onProbe: (cb: (p: { id: number }) => void) => on(Ch.MediaProbe, cb),
  sendProbeResult: (id: number, playing: boolean) => ipcRenderer.send(Ch.MediaProbeResult, { id, playing }),
  dropLater: (p: DropPayload): Promise<'saved' | 'ignored'> => ipcRenderer.invoke(Ch.LaterDrop, p),
};

export type OverlayApi = typeof overlayApi;

contextBridge.exposeInMainWorld('overlayApi', overlayApi);
