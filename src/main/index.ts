import { app, type BrowserWindow, nativeTheme, session } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { type AudioDevice, Ch, type OverlayState, type Settings } from '../shared/ipc';
import { HotkeyGesture } from './hotkey/gesture';
import { HotkeyService } from './hotkey/service';
import { registerDashboardIpc, registerOverlayIpc } from './ipc';
import { registerNoteProtocol, registerNoteScheme } from './protocol';
import { RecorderController } from './recorder/controller';
import { loadSettings, saveSettings } from './settings';
import { NoteStore } from './store/note-store';
import { createTray } from './tray';
import { applyTitleBarTheme, createDashboardWindow, createOverlayWindow } from './windows';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) app.quit();

if (process.env.VOICE_NOTES_USER_DATA) app.setPath('userData', process.env.VOICE_NOTES_USER_DATA);
log.initialize();
registerNoteScheme();

const HIDDEN_ARG = '--hidden'; // passed by the login item so startup stays silent
let isQuitting = false;
let dashboard: BrowserWindow | null = null;

function showDashboard(): void {
  if (!dashboard || dashboard.isDestroyed()) {
    dashboard = createDashboardWindow();
    dashboard.on('close', (e) => {
      if (isQuitting) return;
      e.preventDefault();
      dashboard?.hide();
    });
  }
  if (dashboard.isMinimized()) dashboard.restore();
  dashboard.show();
  dashboard.focus();
}

async function boot(): Promise<void> {
  const userData = app.getPath('userData');
  const settingsFile = path.join(userData, 'settings.json');
  const settings: Settings = loadSettings(settingsFile);
  // themeSource drives prefers-color-scheme in every renderer; the dashboard maps that to html.dark.
  nativeTheme.themeSource = settings.theme;
  nativeTheme.on('updated', () => applyTitleBarTheme(dashboard));
  const store = NoteStore.open(userData);
  log.info('[store] reconcile', await store.reconcile());
  registerNoteProtocol(store);

  const overlay = createOverlayWindow();
  // Only the overlay records; the dashboard just plays files through note://.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
    callback(permission === 'media' && wc === overlay.webContents),
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission) => permission === 'media' && wc === overlay.webContents,
  );

  const send = (channel: string, payload?: unknown) => {
    if (!overlay.isDestroyed()) overlay.webContents.send(channel, payload);
  };
  const toDashboard = (channel: string) => {
    if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(channel);
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
      // Keep the gesture in step when recording ends without a key (auto-stop, mic error, watchdog).
      onIdle: () => gesture.reset(),
      onSaved: (note) => {
        log.info('[recorder] saved', note.id, note.durationMs, 'ms');
        toDashboard(Ch.NotesChanged);
      },
    },
  );
  gesture.onEvent((e) => controller.handleGesture(e));
  overlay.webContents.on('did-finish-load', () => send(Ch.OverlayState, idleState()));
  overlay.webContents.on('render-process-gone', (_e, details) => {
    log.error('[overlay] renderer gone', details.reason);
    if (!overlay.isDestroyed()) overlay.webContents.reload();
  });

  let devices: AudioDevice[] = [];
  registerOverlayIpc({ overlay, gesture, controller, onDevices: (d) => (devices = d) });

  const hotkey = new HotkeyService(gesture);
  hotkey.setCombo(settings.hotkey);
  hotkey.setPaused(settings.hotkeyPaused);
  hotkey.start();

  const tray = createTray({
    openDashboard: showDashboard,
    isPaused: () => settings.hotkeyPaused,
    togglePause: () => updateSettings({ hotkeyPaused: !settings.hotkeyPaused }).hotkeyPaused,
    quit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  function updateSettings(patch: Partial<Settings>): Settings {
    Object.assign(settings, saveSettings(settingsFile, patch));
    if (patch.hotkey) hotkey.setCombo(settings.hotkey);
    if (patch.hotkeyPaused !== undefined) {
      hotkey.setPaused(settings.hotkeyPaused);
      tray.refresh();
    }
    if (patch.launchAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: [HIDDEN_ARG] });
    }
    if (patch.showIdlePill !== undefined && controller.state === 'idle') send(Ch.OverlayState, idleState());
    if (patch.theme) nativeTheme.themeSource = settings.theme; // fires 'updated' → caption buttons recolour
    toDashboard(Ch.SettingsChanged);
    return { ...settings };
  }

  registerDashboardIpc({
    getDashboard: () => dashboard,
    store,
    hotkey,
    getSettings: () => ({ ...settings }),
    updateSettings,
    getDevices: () => devices,
    notesChanged: () => toDashboard(Ch.NotesChanged),
    foldersChanged: () => toDashboard(Ch.FoldersChanged),
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });
  app.on('will-quit', () => {
    hotkey.stop();
    store.close();
  });

  if (process.env.VOICE_NOTES_TEST === '1') {
    (globalThis as Record<string, unknown>).__voiceNotes = { gesture, controller, store };
  }

  if (!process.argv.includes(HIDDEN_ARG)) showDashboard();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showDashboard);
  // The overlay window always exists, so this only fires during quit; never auto-quit on window close.
  app.on('window-all-closed', () => undefined);
  app.whenReady().then(boot).catch((err) => {
    log.error('[boot] failed', err);
    app.quit();
  });
}
