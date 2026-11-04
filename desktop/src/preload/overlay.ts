import { contextBridge, ipcRenderer } from 'electron';
import {
  type AudioDevice,
  type AudioPayload,
  type CaptureResult,
  type DropResult,
  Ch,
  type DictationAudio,
  type DropPayload,
  type OverlayState,
  type PomodoroAction,
  type PomodoroSettings,
  type RecordingSource,
} from '../shared/channels';
import type { Pomodoro } from '../shared/pomodoro';

const on = <T>(channel: string, cb: (payload: T) => void) => {
  ipcRenderer.on(channel, (_e, payload: T) => cb(payload));
};

const overlayApi = {
  onStart: (cb: (p: { deviceId: string | null; source: RecordingSource; ping?: boolean; dictation?: { ping: boolean } }) => void) =>
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
  upgrade: () => ipcRenderer.send(Ch.OverlayUpgrade),
  undo: (id: string) => ipcRenderer.send(Ch.OverlayUndo, { id }),
  move: (id: string, pageId: string) => ipcRenderer.send(Ch.OverlayMove, { id, pageId }),
  openMove: () => ipcRenderer.send(Ch.OverlayMoveOpen),
  cancelMove: () => ipcRenderer.send(Ch.OverlayMoveCancel),
  onNeedWav: (cb: (req: { requestId: number; bytes: Uint8Array; mimeType: string }) => void) => on(Ch.TranscriptionNeedWav, cb),
  sendWav: (reply: { requestId: number; bytes: Uint8Array } | { requestId: number; error: string }) => ipcRenderer.send(Ch.OverlayWav, reply),
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
  onPomodoroConfig: (cb: (cfg: PomodoroSettings) => void) => on(Ch.PomodoroConfig, cb),
  onPomodoroCommand: (cb: (p: { action: PomodoroAction }) => void) => on(Ch.PomodoroCommand, cb),
  sendPomodoro: (timer: Pomodoro) => ipcRenderer.send(Ch.PomodoroState, timer),
  pomodoroDone: (focusMs: number) => ipcRenderer.send(Ch.PomodoroDone, { focusMs }),
  dropLater: (p: DropPayload): Promise<DropResult> => ipcRenderer.invoke(Ch.LaterDrop, p),
  captureLater: (): Promise<CaptureResult> => ipcRenderer.invoke(Ch.LaterCapture),
};

export type OverlayApi = typeof overlayApi;

contextBridge.exposeInMainWorld('overlayApi', overlayApi);
