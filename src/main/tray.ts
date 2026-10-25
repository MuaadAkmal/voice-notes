import { Menu, nativeImage, Tray } from 'electron';
import type { RecordingSource } from '../shared/channels';
// Inlined so packaging needs no extra resources.
import tray16 from '../../assets/tray-16.png?inline';
import tray32 from '../../assets/tray-32.png?inline';


type TrayActions = {
  openDashboard(): void;
  togglePause(): boolean;
  isPaused(): boolean;
  getSource(): RecordingSource;
  setSource(source: RecordingSource): void;
  resetPill(): void;
  quit(): void;
};

const SOURCES: { value: RecordingSource; label: string }[] = [
  { value: 'mic', label: 'Microphone' },
  { value: 'system', label: 'System audio' },
  { value: 'both', label: 'Both' },
];

export function createTray(actions: TrayActions): { tray: Tray; refresh: () => void } {
  const icon = nativeImage.createEmpty();
  icon.addRepresentation({ scaleFactor: 1, dataURL: tray16 });
  icon.addRepresentation({ scaleFactor: 2, dataURL: tray32 });
  const tray = new Tray(icon);
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
        {
          label: 'Record from',
          submenu: SOURCES.map(({ value, label }) => ({
            label,
            type: 'radio' as const,
            checked: actions.getSource() === value,
            click: () => actions.setSource(value),
          })),
        },
        { label: 'Reset pill position', click: actions.resetPill },
        { type: 'separator' },
        { label: 'Quit Voice Notes', click: actions.quit },
      ]),
    );
  tray.setToolTip('Voice Notes');
  tray.on('click', actions.openDashboard);
  rebuild();
  return { tray, refresh: rebuild };
}
