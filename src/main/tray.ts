import { Menu, nativeImage, Tray } from 'electron';

// 32×32 mic glyph, inlined so packaging needs no extra resources.
const ICON = 'data:image/png;base64,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';

type TrayActions = { openDashboard(): void; togglePause(): boolean; isPaused(): boolean; quit(): void };

export function createTray(actions: TrayActions): { tray: Tray; refresh: () => void } {
  const tray = new Tray(nativeImage.createFromDataURL(ICON));
  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open dashboard', click: actions.openDashboard },
        {
          label: 'Pause hotkey',
          type: 'checkbox',
          checked: actions.isPaused(),
          click: () => {
            actions.togglePause();
            rebuild();
          },
        },
        { type: 'separator' },
        { label: 'Quit Voice Notes', click: actions.quit },
      ]),
    );
  tray.setToolTip('Voice Notes');
  tray.on('click', actions.openDashboard);
  rebuild();
  return { tray, refresh: rebuild };
}
