import { app, type BrowserWindow, session } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { Ch, type OverlayState } from '../shared/ipc';
import { HotkeyGesture } from './hotkey/gesture';
import { HotkeyService } from './hotkey/service';
import { registerOverlayIpc } from './ipc';
import { RecorderController } from './recorder/controller';
import { loadSettings } from './settings';
import { NoteStore } from './store/note-store';
import { createDashboardWindow, createOverlayWindow } from './windows';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) app.quit();

if (process.env.VOICE_NOTES_USER_DATA) app.setPath('userData', process.env.VOICE_NOTES_USER_DATA);
log.initialize();

let dashboard: BrowserWindow | null = null;

function showDashboard(): void {
  if (!dashboard || dashboard.isDestroyed()) {
    dashboard = createDashboardWindow();
    dashboard.on('closed', () => app.quit());
  }
  if (dashboard.isMinimized()) dashboard.restore();
  dashboard.show();
  dashboard.focus();
}

async function boot(): Promise<void> {
  const userData = app.getPath('userData');
  const settings = loadSettings(path.join(userData, 'settings.json'));
  const store = NoteStore.open(userData);
  log.info('[store] reconcile', await store.reconcile());

  const overlay = createOverlayWindow();
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
    callback(permission === 'media' && wc === overlay.webContents),
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission) => permission === 'media' && wc === overlay.webContents,
  );

  const send = (channel: string, payload?: unknown) => {
    if (!overlay.isDestroyed()) overlay.webContents.send(channel, payload);
  };
  const idleState = (): OverlayState => ({ kind: 'idle', visible: settings.showIdlePill });
  const gesture = new HotkeyGesture();
  const controller = new RecorderController(
    {
      start: (deviceId) => send(Ch.RecorderStart, { deviceId }),
      stop: () => send(Ch.RecorderStop),
      cancel: () => send(Ch.RecorderCancel),
      setState: (s) => send(Ch.OverlayState, s),
    },
    store,
    {
      getDeviceId: () => settings.micDeviceId,
      idleState,
      onSaved: (note) => {
        log.info('[recorder] saved', note.id, note.durationMs, 'ms');
        dashboard?.webContents.send(Ch.NotesChanged);
      },
    },
  );
  gesture.onEvent((e) => controller.handleGesture(e));
  overlay.webContents.on('did-finish-load', () => send(Ch.OverlayState, idleState()));
  registerOverlayIpc({ overlay, gesture, controller });

  const hotkey = new HotkeyService(gesture);
  hotkey.setCombo(settings.hotkey);
  hotkey.setPaused(settings.hotkeyPaused);
  hotkey.start();
  app.on('will-quit', () => {
    hotkey.stop();
    store.close();
  });

  if (process.env.VOICE_NOTES_TEST === '1') {
    (globalThis as Record<string, unknown>).__voiceNotes = { gesture, controller, store };
  }

  showDashboard();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showDashboard);
  app.whenReady().then(boot).catch((err) => {
    log.error('[boot] failed', err);
    app.quit();
  });
}
