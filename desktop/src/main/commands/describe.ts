import { appName, captureLabel, isChromium } from '../../shared/capture-line';
import type { Capture } from './capture';
import type { FileHit } from './file-path';

// What the captured window shows, for "add this to …": a link (Chromium address bar, or an Office
// document on OneDrive), else a local path, else a screenshot, else only its label. A probe that
// fails counts as finding nothing. The log names the kind found, never the title, link or path.

export type Described = { label: string; app: string; url?: string; path?: string; image?: Uint8Array };

export type Probes = {
  browserUrl(c: Capture): Promise<string | null>;
  filePath(c: Capture): Promise<FileHit | null>;
  screenshot(hwnd: number): Promise<Uint8Array | null>;
};

const quiet = <T>(p: Promise<T | null>): Promise<T | null> => p.catch(() => null);

export async function describeCapture(c: Capture, p: Probes, log?: (line: string) => void): Promise<Described> {
  const started = Date.now();
  const d: Described = { label: captureLabel(c.title, c.processName), app: appName(c.processName) };
  if (isChromium(c.processName)) {
    const url = await quiet(p.browserUrl(c));
    if (url) d.url = url;
  } else {
    const hit = await quiet(p.filePath(c));
    if (hit && 'url' in hit) d.url = hit.url;
    else if (hit) d.path = hit.path;
  }
  if (!d.url && !d.path) {
    const image = await quiet(p.screenshot(c.hwnd));
    if (image) d.image = image;
  }
  const kind = d.url ? 'url' : d.path ? 'path' : d.image ? 'image' : 'none';
  log?.(`[commands] capture ${c.processName.toLowerCase()} ${kind} ${Date.now() - started}ms`);
  return d;
}
