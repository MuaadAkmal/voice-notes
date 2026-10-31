import { clipboard, ClipboardItem } from 'electron';
import log from 'electron-log/main';
import type { ClipboardPort } from './paste';

type Payload = Blob | string | Electron.ClipboardBookmark;

/** Copies every format out of the clipboard now: items from read() may fetch lazily, after we've overwritten it. */
async function snapshot(): Promise<ClipboardItem[]> {
  const items = await clipboard.read();
  return Promise.all(
    items.map(async (item) => {
      const data: Record<string, Payload> = {};
      for (const type of item.types) {
        try {
          data[type] = await item.getType(type);
        } catch (err) {
          log.warn('[dictation] clipboard format not saved', type, err);
        }
      }
      return new ClipboardItem(data);
    }),
  );
}

export const electronClipboard: ClipboardPort<ClipboardItem[]> = {
  snapshot,
  restore: async (items) => {
    if (items.length === 0) clipboard.clear();
    else await clipboard.write(items);
  },
  writeText: (text) => clipboard.writeText(text),
};
