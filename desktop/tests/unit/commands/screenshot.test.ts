import { expect, it, vi } from 'vitest';
import { windowScreenshot, type Sources } from '../../../src/main/commands/screenshot';

const thumb = (bytes: number, empty = false) => ({ isEmpty: () => empty, toJPEG: vi.fn(() => Buffer.alloc(bytes, 1)) });

it("takes that window's thumbnail as JPEG 85, fit in 1280×1280", async () => {
  const mine = thumb(10);
  const getSources = vi.fn<Sources>(async () => [
    { id: 'window:70:0', thumbnail: thumb(5) },
    { id: 'window:7:0', thumbnail: mine },
  ]);
  expect(await windowScreenshot(7, getSources)).toEqual(new Uint8Array(10).fill(1));
  expect(getSources).toHaveBeenCalledWith({ types: ['window'], thumbnailSize: { width: 1280, height: 1280 } });
  expect(mine.toJPEG).toHaveBeenCalledWith(85);
});

it('no window, an empty thumbnail or one over 2 MB gives null', async () => {
  expect(await windowScreenshot(7, async () => [{ id: 'window:70:0', thumbnail: thumb(5) }])).toBeNull();
  expect(await windowScreenshot(7, async () => [{ id: 'window:7:0', thumbnail: thumb(5, true) }])).toBeNull();
  expect(await windowScreenshot(7, async () => [{ id: 'window:7:0', thumbnail: thumb(2 * 1024 * 1024 + 1) }])).toBeNull();
  expect(await windowScreenshot(7, async () => Promise.reject(new Error('x')))).toBeNull();
});
