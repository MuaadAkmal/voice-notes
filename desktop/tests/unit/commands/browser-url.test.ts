import { expect, it, vi } from 'vitest';
import { readBrowserUrl } from '../../../src/main/commands/browser-url';
import type { Capture } from '../../../src/main/commands/capture';

const cap = (processName: string): Capture => ({ hwnd: 7, title: 'V - YouTube - Google Chrome', processName, pid: 9 });

it('only asks Chromium browsers', async () => {
  const run = vi.fn(async () => ({ url: 'x.com' }));
  expect(await readBrowserUrl(cap('firefox.exe'), run)).toBeNull();
  expect(await readBrowserUrl(cap('explorer.exe'), run)).toBeNull();
  expect(run).not.toHaveBeenCalled();
});

it('normalises the address bar value and passes the window handle', async () => {
  const run = vi.fn(async () => ({ url: 'youtube.com/watch?v=x' }));
  expect(await readBrowserUrl(cap('chrome.exe'), run)).toBe('https://youtube.com/watch?v=x');
  expect(run).toHaveBeenCalledWith(expect.any(String), { VN_HWND: '7' });
});

it('garbage output gives null', async () => {
  for (const out of [{ url: 'how to cook' }, { url: null }, null, 'x', { url: 5 }])
    expect(await readBrowserUrl(cap('msedge.exe'), async () => out)).toBeNull();
});
