import { type BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import log from 'electron-log/main';
import type { z } from 'zod';
import { AudioPayloadSchema, Ch, ErrorSchema, PointerSchema } from '../shared/ipc';
import type { HotkeyGesture } from './hotkey/gesture';
import type { RecorderController } from './recorder/controller';

type OverlayDeps = { overlay: BrowserWindow; gesture: HotkeyGesture; controller: RecorderController };

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

export function registerOverlayIpc({ overlay, gesture, controller }: OverlayDeps): void {
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
