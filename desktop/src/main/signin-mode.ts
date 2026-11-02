import { type BrowserWindow, ipcMain, type IpcMainInvokeEvent, Menu, nativeImage, Tray } from 'electron';
import { Ch } from '../shared/channels';
import tray16 from '../../assets/tray-16.png?inline';
import tray32 from '../../assets/tray-32.png?inline';
import type { AccountService } from './account/account';

type Deps = {
  account: AccountService;
  getDashboard(): BrowserWindow | null;
  showDashboard(): void;
  quit(): void;
};

/**
 * Signed out: only the dashboard window, showing the sign-in screen, and a tray to reopen it or quit. No pill,
 * hotkeys, reminders or sync exist in this mode. Signing in restarts into that account's profile.
 */
export function startSignIn(d: Deps): Tray {
  const handle = (channel: string, fn: () => unknown) =>
    ipcMain.handle(channel, (event: IpcMainInvokeEvent) => {
      const win = d.getDashboard();
      if (!win || event.sender !== win.webContents) throw new Error('Forbidden');
      return fn();
    });
  handle(Ch.AppMode, () => 'signin');
  handle(Ch.AccountGet, () => d.account.current());
  handle(Ch.AccountSignIn, () => d.account.signIn());
  handle(Ch.AccountCancel, () => d.account.cancel());

  const icon = nativeImage.createEmpty();
  icon.addRepresentation({ scaleFactor: 1, dataURL: tray16 });
  icon.addRepresentation({ scaleFactor: 2, dataURL: tray32 });
  const tray = new Tray(icon);
  tray.setToolTip('Voice Notes');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Voice Notes', click: d.showDashboard },
      { type: 'separator' },
      { label: 'Quit', click: d.quit },
    ]),
  );
  tray.on('click', d.showDashboard);
  d.showDashboard();
  return tray;
}
