import { BrowserWindow, nativeImage, nativeTheme, screen } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PillPosition } from '../shared/channels';
import { resolveOverlayBounds } from './overlay-position';
// The packaged exe carries the icon already; dev runs electron.exe, so set it on the window too.
import appIcon from '../../assets/icon.png?inline';

const OVERLAY_WIDTH = 320; // compact pill: glyph + waveform + timer (+ discard ×)
const OVERLAY_HEIGHT = 80;
const TITLEBAR_HEIGHT = 40; // keep in sync with the dashboard's h-10 drag strip
// Caption-button strip colours; `color` matches the dashboard background in each theme.
const TITLEBAR = {
  light: { color: '#f7f5f2', symbolColor: '#44403c' },
  dark: { color: '#1f1f1f', symbolColor: '#d6d3d1' },
};

const titleBarColors = () => (nativeTheme.shouldUseDarkColors ? TITLEBAR.dark : TITLEBAR.light);

/** Recolour the native caption buttons after the effective theme changes. */
export function applyTitleBarTheme(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  win.setTitleBarOverlay({ ...titleBarColors(), height: TITLEBAR_HEIGHT });
  win.setBackgroundColor(titleBarColors().color);
}

const secureWebPreferences = (preload: string) => ({
  preload: path.join(__dirname, preload),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
});

function loadRenderer(win: BrowserWindow, devUrl: string | undefined, name: string): void {
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${name}/index.html`));
  }
}

/** True when `url` is the app page itself (hash and query aside), e.g. a dev-server reload. */
function isAppUrl(url: string, appUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(appUrl);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

export function positionOverlay(win: BrowserWindow, saved: PillPosition | null): void {
  const displays = screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }));
  win.setBounds(
    resolveOverlayBounds(saved, displays, screen.getPrimaryDisplay().id, { width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT }),
  );
}

/** The user dragged the pill here: express it relative to the display it ended up on. */
export function pillPositionOf(win: BrowserWindow): PillPosition {
  const b = win.getBounds();
  const display = screen.getDisplayMatching(b);
  return { displayId: display.id, x: b.x - display.workArea.x, y: b.y - display.workArea.y };
}

/** Transparent, click-through, always-on-top strip that never takes focus (same technique as Wispr Flow). */
export function createOverlayWindow(getSaved: () => PillPosition | null): BrowserWindow {
  const win = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    type: 'toolbar',
    webPreferences: secureWebPreferences('overlay.cjs'),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  positionOverlay(win, getSaved());
  win.once('ready-to-show', () => win.showInactive());

  const reposition = () => !win.isDestroyed() && positionOverlay(win, getSaved());
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  win.on('closed', () => {
    screen.off('display-metrics-changed', reposition);
    screen.off('display-added', reposition);
    screen.off('display-removed', reposition);
  });

  loadRenderer(win, OVERLAY_VITE_DEV_SERVER_URL, OVERLAY_VITE_NAME);
  return win;
}

export function createDashboardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    title: 'Voice Notes',
    icon: nativeImage.createFromDataURL(appIcon),
    autoHideMenuBar: true,
    backgroundColor: titleBarColors().color,
    // Frameless look like Wispr Flow, but keep native caption buttons (and Windows 11 snap layouts).
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...titleBarColors(), height: TITLEBAR_HEIGHT },
    webPreferences: secureWebPreferences('dashboard.cjs'),
  });
  // The dashboard renders user markdown: it never opens windows or leaves its own page (links go through openExternal).
  const appUrl = DASHBOARD_VITE_DEV_SERVER_URL
    ? DASHBOARD_VITE_DEV_SERVER_URL
    : pathToFileURL(path.join(__dirname, `../renderer/${DASHBOARD_VITE_NAME}/index.html`)).toString();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, appUrl)) event.preventDefault();
  });
  loadRenderer(win, DASHBOARD_VITE_DEV_SERVER_URL, DASHBOARD_VITE_NAME);
  return win;
}
