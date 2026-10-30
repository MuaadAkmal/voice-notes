import fs from 'node:fs';
import path from 'node:path';
import { captureLabel, isChromium, normaliseUrl } from '../../shared/capture-line';
import type { Capture } from './capture';
import { runPowerShell, type RunPowerShell } from './powershell';

// The file (or folder) a window shows. Explorer and Office can say so directly (picked by window
// handle, then by title); other apps only through the command line they were started with, which
// counts only when it names an existing file whose name is in the window title, so a wrong file is
// never named.

export type FileHit = { path: string } | { url: string };

/** Whether a path is a file, a folder, or neither. Never blocks main: an offline share times out. */
export type PathKind = (p: string) => Promise<'file' | 'dir' | null>;

const STAT_TIMEOUT_MS = 1500;

export const pathKind: PathKind = (p) =>
  Promise.race([
    fs.promises.stat(p).then(
      (s) => (s.isFile() ? 'file' : s.isDirectory() ? 'dir' : null),
      () => null,
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), STAT_TIMEOUT_MS)),
  ]);

// Windows 11 tabs are one Shell window each, all with the same HWND: return them all.
const EXPLORER = `
$h = [long]$env:VN_HWND
$tabs = @()
foreach ($w in (New-Object -ComObject Shell.Application).Windows()) {
  try { if ([long]$w.HWND -eq $h) { $tabs += @{ path = $w.Document.Folder.Self.Path; name = $w.LocationName } } } catch {}
}
@{ tabs = $tabs } | ConvertTo-Json -Compress -Depth 3
`;

// VN_PROGID comes from the fixed map below.
const OFFICE = `
$app = [Runtime.InteropServices.Marshal]::GetActiveObject($env:VN_PROGID)
$docs = switch ($env:VN_PROGID) { 'Word.Application' { $app.Documents } 'Excel.Application' { $app.Workbooks } default { $app.Presentations } }
$out = @()
foreach ($d in $docs) {
  $h = @()
  try { foreach ($w in $d.Windows) { try { $h += [long]$w.Hwnd } catch {} } } catch {}
  $out += @{ name = $d.Name; fullName = $d.FullName; hwnds = $h }
}
@{ docs = $out } | ConvertTo-Json -Compress -Depth 4
`;

const COMMAND_LINE = `
$c = (Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$env:VN_PID)").CommandLine
@{ commandLine = $c } | ConvertTo-Json -Compress
`;

const OFFICE_APPS: Record<string, string> = {
  winword: 'Word.Application',
  excel: 'Excel.Application',
  powerpnt: 'PowerPoint.Application',
};

// ConvertTo-Json writes a one-element array as the element itself.
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Arguments of a Windows command line; double quotes group, and are dropped. */
export function splitCommandLine(s: string): string[] {
  const args: string[] = [];
  let cur = '';
  let quoted = false;
  let started = false;
  for (const ch of s) {
    if (ch === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(ch) && !quoted) {
      if (started) args.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) args.push(cur);
  return args;
}

/** The argument (never the program itself) that is an existing absolute file named in the title. */
export async function pathFromCommandLine(commandLine: string, title: string, kind: PathKind): Promise<string | null> {
  const t = title.toLowerCase();
  for (const arg of splitCommandLine(commandLine).slice(1)) {
    if (!/^(?:[a-z]:\\|\\\\)/i.test(arg)) continue;
    const name = path.win32.basename(arg).toLowerCase();
    const stem = path.win32.parse(arg).name.toLowerCase();
    if (!(inTitle(t, name) || inTitle(t, stem))) continue;
    if ((await kind(arg)) === 'file') return arg;
  }
  return null;
}

/** `word` appears in `title` on its own: "a" is not in "b.txt - notepad". */
function inTitle(title: string, word: string): boolean {
  if (!word) return false;
  const edge = /[\p{L}\p{N}]/u;
  for (let i = title.indexOf(word); i !== -1; i = title.indexOf(word, i + 1)) {
    const before = title[i - 1];
    const after = title[i + word.length];
    if ((!before || !edge.test(before)) && (!after || !edge.test(after))) return true;
  }
  return false;
}

/** The Explorer tab the title names ("Downloads - File Explorer"); a lone tab is that tab. */
export function pickExplorerTab(tabs: { path: string; name: string }[], title: string): string | null {
  if (tabs.length === 1) return tabs[0].path;
  const label = captureLabel(title, 'explorer.exe').toLowerCase();
  const named = tabs.filter((t) => t.name.toLowerCase() === label);
  return named.length === 1 ? named[0].path : null;
}

/** The open document shown in window `hwnd`; without handles, the one whose name starts the title. */
export function pickOfficeDoc(docs: { name: string; fullName: string; hwnds: number[] }[], hwnd: number, title: string): string | null {
  const byHandle = docs.find((d) => d.hwnds.includes(hwnd));
  if (byHandle) return byHandle.fullName;
  const t = title.toLowerCase();
  let best: { fullName: string; length: number } | null = null;
  for (const d of docs) {
    for (const n of [d.name, path.win32.parse(d.name).name]) {
      const name = n.toLowerCase();
      const next = t[name.length];
      if (name && t.startsWith(name) && (next === undefined || next === ' ') && (!best || name.length > best.length))
        best = { fullName: d.fullName, length: name.length };
    }
  }
  return best?.fullName ?? null;
}

export async function readFilePath(c: Capture, run: RunPowerShell = runPowerShell, kind: PathKind = pathKind): Promise<FileHit | null> {
  if (isChromium(c.processName)) return null;
  const proc = c.processName.toLowerCase().replace(/\.exe$/, '');
  const progId = OFFICE_APPS[proc];
  const out = (
    proc === 'explorer'
      ? await run(EXPLORER, { VN_HWND: String(c.hwnd) })
      : progId
        ? await run(OFFICE, { VN_PROGID: progId, VN_HWND: String(c.hwnd) })
        : await run(COMMAND_LINE, { VN_PID: String(c.pid) })
  ) as { commandLine?: unknown; tabs?: unknown; docs?: unknown } | null;
  if (!out || typeof out !== 'object') return null;

  if (typeof out.commandLine === 'string') {
    const p = await pathFromCommandLine(out.commandLine, c.title, kind);
    return p ? { path: p } : null;
  }
  if ('tabs' in out) {
    const tabs = list(out.tabs).filter(
      (t): t is { path: string; name: string } => typeof (t as { path?: unknown })?.path === 'string' && typeof (t as { name?: unknown }).name === 'string',
    );
    const p = pickExplorerTab(tabs, c.title);
    return p && !p.startsWith('::') && (await kind(p)) === 'dir' ? { path: p } : null;
  }
  if ('docs' in out) {
    const docs = list(out.docs)
      .filter((d): d is { name: string; fullName: string; hwnds?: unknown } => {
        const x = d as { name?: unknown; fullName?: unknown } | null;
        return typeof x?.name === 'string' && typeof x.fullName === 'string';
      })
      .map((d) => ({ name: d.name, fullName: d.fullName, hwnds: list(d.hwnds).filter((h): h is number => typeof h === 'number') }));
    const p = pickOfficeDoc(docs, c.hwnd, c.title);
    if (!p) return null;
    if (/^https?:\/\//i.test(p)) {
      const url = normaliseUrl(p);
      return url ? { url } : null;
    }
    return (await kind(p)) === 'file' ? { path: p } : null;
  }
  return null;
}
