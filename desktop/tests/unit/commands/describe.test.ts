import { expect, it, vi } from 'vitest';
import type { Capture } from '../../../src/main/commands/capture';
import { describeCapture, type Probes } from '../../../src/main/commands/describe';

const CHROME: Capture = { hwnd: 7, title: 'How Rust works - YouTube - Google Chrome', processName: 'chrome.exe', pid: 9 };
const WORD: Capture = { hwnd: 8, title: 'report.docx - Word', processName: 'WINWORD.EXE', pid: 10 };
const IMG = new Uint8Array([1, 2]);

function probes(over: Partial<Probes> = {}) {
  return {
    browserUrl: vi.fn<Probes['browserUrl']>(async () => null),
    filePath: vi.fn<Probes['filePath']>(async () => null),
    screenshot: vi.fn<Probes['screenshot']>(async () => null),
    ...over,
  };
}

it('Chromium: the url, and nothing else is tried', async () => {
  const p = probes({ browserUrl: vi.fn(async () => 'https://y.com/w') });
  expect(await describeCapture(CHROME, p)).toEqual({ label: 'How Rust works', app: 'Chrome', url: 'https://y.com/w' });
  expect(p.screenshot).not.toHaveBeenCalled();
});

it('Chromium without a url: a screenshot, never the path probe', async () => {
  const p = probes({ screenshot: vi.fn(async () => IMG) });
  expect(await describeCapture(CHROME, p)).toEqual({ label: 'How Rust works', app: 'Chrome', image: IMG });
  expect(p.filePath).not.toHaveBeenCalled();
  expect(p.screenshot).toHaveBeenCalledWith(7);
});

it('other apps: the path first, then a screenshot', async () => {
  const p = probes({ filePath: vi.fn(async () => ({ path: 'C:\\Docs\\report.docx' })) });
  expect(await describeCapture(WORD, p)).toEqual({ label: 'report.docx', app: 'Word', path: 'C:\\Docs\\report.docx' });
  expect(p.browserUrl).not.toHaveBeenCalled();
  expect(p.screenshot).not.toHaveBeenCalled();
  const q = probes({ filePath: vi.fn(async () => ({ url: 'https://contoso.sharepoint.com/r.docx' })) });
  expect(await describeCapture(WORD, q)).toEqual({ label: 'report.docx', app: 'Word', url: 'https://contoso.sharepoint.com/r.docx' });
});

it('everything failing (even a probe that throws) leaves label and app', async () => {
  const p = probes({ filePath: vi.fn(async () => Promise.reject(new Error('boom'))) });
  expect(await describeCapture(WORD, p)).toEqual({ label: 'report.docx', app: 'Word' });
});

it('logs which kind it found, never the title or url', async () => {
  const log = vi.fn();
  await describeCapture(CHROME, probes({ browserUrl: vi.fn(async () => 'https://y.com/secret') }), log);
  const line = log.mock.calls[0][0] as string;
  expect(line).toMatch(/^\[commands\] capture chrome\.exe url \d+ms$/);
  expect(line).not.toContain('Rust');
  expect(line).not.toContain('secret');
});
