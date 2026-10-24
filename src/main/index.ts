import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createDashboard = () => {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    webPreferences: {
      preload: path.join(__dirname, 'dashboard.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (DASHBOARD_VITE_DEV_SERVER_URL) {
    win.loadURL(DASHBOARD_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${DASHBOARD_VITE_NAME}/index.html`));
  }
};

app.whenReady().then(createDashboard);

app.on('window-all-closed', () => app.quit());
