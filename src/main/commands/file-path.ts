import fs from 'node:fs';
import path from 'node:path';
import { isChromium, normaliseUrl } from '../../shared/capture-line';
import type { Capture } from './capture';
import { runPowerShell, type RunPowerShell } from './powershell';

// The file (or folder) a window shows. Explorer and Office can say so directly; other apps only
// through the command line they were started with, which counts only when it names an existing
// file whose name is in the window title, so a wrong file is never named.

export type FileHit = { path: string } | { url: string };

const EXPLORER = `
$h = [long]$env:VN_HWND
$p = $null
foreach ($w in (New-Object -ComObject Shell.Application).Windows()) {
  try { if ([long]$w.HWND -eq $h) { $p = $w.Document.Folder.Self.Path; break } } catch {}
}
@{ path = $p } | ConvertTo-Json -Compress
`;

// VN_PROGID comes from the fixed map below; VN_TITLE is only compared, never run.
const OFFICE = `
$app = [Runtime.InteropServices.Marshal]::GetActiveObject($env:VN_PROGID)
$docs = switch ($env:VN_PROGID) { 'Word.Application' { $app.Documents } 'Excel.Application' { $app.Workbooks } default { $app.Presentations } }
$t = $env:VN_TITLE
$p = $null
foreach ($d in $docs) {
  if ($t.Contains($d.Name) -or $t.Contains([IO.Path]::GetFileNameWithoutExtension($d.Name))) { $p = $d.FullName; break }
}
@{ path = $p } | ConvertTo-Json -Compress
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
export function pathFromCommandLine(commandLine: string, title: string, exists: (p: string) => boolean): string | null {
  const t = title.toLowerCase();
  for (const arg of splitCommandLine(commandLine).slice(1)) {
    if (!/^(?:[a-z]:\\|\\\\)/i.test(arg)) continue;
    const name = path.win32.basename(arg).toLowerCase();
    const stem = path.win32.parse(arg).name.toLowerCase();
    if (!(inTitle(t, name) || inTitle(t, stem))) continue;
    if (exists(arg)) return arg;
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

export async function readFilePath(
  c: Capture,
  run: RunPowerShell = runPowerShell,
  exists: (p: string) => boolean = fs.existsSync,
): Promise<FileHit | null> {
  if (isChromium(c.processName)) return null;
  const proc = c.processName.toLowerCase().replace(/\.exe$/, '');
  const progId = OFFICE_APPS[proc];
  const out = (
    proc === 'explorer'
      ? await run(EXPLORER, { VN_HWND: String(c.hwnd) })
      : progId
        ? await run(OFFICE, { VN_PROGID: progId, VN_TITLE: c.title })
        : await run(COMMAND_LINE, { VN_PID: String(c.pid) })
  ) as { path?: unknown; commandLine?: unknown } | null;
  if (!out || typeof out !== 'object') return null;
  if (typeof out.commandLine === 'string') {
    const p = pathFromCommandLine(out.commandLine, c.title, exists);
    return p ? { path: p } : null;
  }
  if (typeof out.path !== 'string' || !out.path) return null;
  if (/^https?:\/\//i.test(out.path)) {
    const url = normaliseUrl(out.path);
    return url ? { url } : null;
  }
  return out.path.startsWith('::') || !exists(out.path) ? null : { path: out.path };
}
