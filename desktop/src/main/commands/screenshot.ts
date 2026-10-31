// A picture of one window (never the whole screen), for "add this to …" when neither a link nor a
// path could be read. Electron's window sources are named `window:<hwnd>:<n>` on Windows.
// Protected video (Netflix in Chrome/Edge) comes out black; that's Windows, not us.

export type Sources = (opts: {
  types: ['window'];
  thumbnailSize: { width: number; height: number };
}) => Promise<{ id: string; thumbnail: { isEmpty(): boolean; toJPEG(quality: number): Buffer } }[]>;

const MAX_BYTES = 2 * 1024 * 1024;

export async function windowScreenshot(hwnd: number, getSources: Sources): Promise<Uint8Array | null> {
  try {
    const sources = await getSources({ types: ['window'], thumbnailSize: { width: 1280, height: 1280 } });
    const source = sources.find((s) => s.id.split(':')[1] === String(hwnd));
    if (!source || source.thumbnail.isEmpty()) return null; // minimised, or closed meanwhile
    const jpeg = source.thumbnail.toJPEG(85);
    return jpeg.length > 0 && jpeg.length <= MAX_BYTES ? new Uint8Array(jpeg) : null;
  } catch {
    return null;
  }
}
