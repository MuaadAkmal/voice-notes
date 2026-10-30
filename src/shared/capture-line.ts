import { showFromTitle } from './show';

// Voice to lists, "add this to …": the line that stands for the window the user was looking at.
// A link for a web page, the path for a local file, a screenshot when neither could be read.

export type LineParts = { label: string; app: string; url?: string; path?: string; imageSrc?: string };

const MAX_LABEL = 120;
const MAX_URL = 2000;

const CHROMIUM = new Set(['chrome', 'msedge', 'brave', 'vivaldi', 'opera', 'arc']);

const APP_NAMES: Record<string, string> = {
  chrome: 'Chrome', msedge: 'Edge', brave: 'Brave', vivaldi: 'Vivaldi', opera: 'Opera', arc: 'Arc', firefox: 'Firefox',
  explorer: 'File Explorer', vlc: 'VLC', winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint', code: 'VS Code',
  notepad: 'Notepad', acrord32: 'Acrobat', acrobat: 'Acrobat', mspaint: 'Paint', obsidian: 'Obsidian',
};

// The app's own name at the end of its window title: "report.docx - Word", "Downloads - File Explorer".
const APP_SUFFIX = new RegExp(
  String.raw`\s[-—–|·]\s(?:Google Chrome|Microsoft[\s​]*Edge|Mozilla Firefox|Brave|Vivaldi|Opera|Visual Studio Code|` +
    String.raw`Word|Excel|PowerPoint|Notepad|File Explorer|VLC media player|Paint|Photos|Adobe Acrobat[^-—–|·]*|Obsidian)$`,
  'i',
);

const base = (processName: string) => processName.toLowerCase().replace(/\.exe$/, '');
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();

export function isChromium(processName: string): boolean {
  return CHROMIUM.has(base(processName));
}

export function appName(processName: string): string {
  return APP_NAMES[base(processName)] ?? processName.replace(/\.exe$/i, '');
}

/** "How Rust lifetimes work - YouTube - Google Chrome" → "How Rust lifetimes work"; never empty. */
export function captureLabel(title: string, processName: string): string {
  const full = oneLine(title);
  const label = showFromTitle(full, processName) ?? (full.replace(APP_SUFFIX, '').trim() || full);
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

/** Address bar text as an http(s) url ("youtube.com/watch?v=x" → "https://youtube.com/watch?v=x"), else null. */
export function normaliseUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > MAX_URL) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(?:about|data|javascript|mailto|file):/i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
  return withScheme;
}

export function captureLine(p: LineParts): string {
  const label = oneLine(p.label);
  const escaped = label.replace(/[\\[\]]/g, '\\$&');
  if (p.url) return `[${escaped}](${p.url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20')})`;
  const named = label.toLowerCase() === p.app.toLowerCase() ? label : `${label} (${p.app})`;
  if (p.path) return `${named} · ${p.path.includes('`') ? p.path : `\`${p.path}\``}`;
  if (p.imageSrc) return `${named} ![${escaped}](${p.imageSrc})`;
  return named;
}
