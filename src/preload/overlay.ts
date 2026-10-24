import { contextBridge, ipcRenderer } from 'electron';
import { type AudioDevice, type AudioPayload, Ch, type OverlayState, type RecordingSource } from '../shared/channels';

const on = <T>(channel: string, cb: (payload: T) => void) => {
  ipcRenderer.on(channel, (_e, payload: T) => cb(payload));
};

const overlayApi = {
  onStart: (cb: (p: { deviceId: string | null; source: RecordingSource }) => void) => on(Ch.RecorderStart, cb),
  onStop: (cb: () => void) => on(Ch.RecorderStop, cb),
  onCancel: (cb: () => void) => on(Ch.RecorderCancel, cb),
  onState: (cb: (s: OverlayState) => void) => on(Ch.OverlayState, cb),
  sendAudio: (a: AudioPayload) => ipcRenderer.send(Ch.RecorderAudio, a),
  sendError: (message: string) => ipcRenderer.send(Ch.RecorderError, { message }),
  setPointerOver: (over: boolean) => ipcRenderer.send(Ch.OverlayPointer, { over }),
  click: () => ipcRenderer.send(Ch.OverlayClick),
  retry: () => ipcRenderer.send(Ch.OverlayRetry),
  sendDevices: (devices: AudioDevice[]) => ipcRenderer.send(Ch.OverlayDevices, devices),
};

export type OverlayApi = typeof overlayApi;

contextBridge.exposeInMainWorld('overlayApi', overlayApi);
