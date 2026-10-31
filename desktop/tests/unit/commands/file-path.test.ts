import { expect, it, vi } from 'vitest';
import type { Capture } from '../../../src/main/commands/capture';
import {
  pathFromCommandLine,
  pickExplorerTab,
  pickOfficeDoc,
  readFilePath,
  splitCommandLine,
  type PathKind,
} from '../../../src/main/commands/file-path';

const FILM = 'C:\\Films\\Dark S01E03.mkv';
const FILES = [FILM, 'C:\\a.txt', 'C:\\Docs\\report.docx', 'C:\\Docs\\Meeting Notes.docx', 'C:\\Docs\\Notes.docx'];
const DIRS = ['C:\\Users\\me\\Downloads', 'C:\\Users\\me\\Documents', 'C:\\proj'];
const kind: PathKind = async (p) => (FILES.includes(p) ? 'file' : DIRS.includes(p) ? 'dir' : null);
const cap = (processName: string, title: string): Capture => ({ hwnd: 7, title, processName, pid: 9 });

it('splits a Windows command line', () => {
  expect(splitCommandLine(`"C:\\Program Files\\VLC\\vlc.exe" --x "${FILM}" b`)).toEqual([
    'C:\\Program Files\\VLC\\vlc.exe',
    '--x',
    FILM,
    'b',
  ]);
});

it('command line rule: an existing absolute file named in the title', async () => {
  const vlc = `"C:\\Program Files\\VLC\\vlc.exe" --started-from-file "${FILM}"`;
  expect(await pathFromCommandLine(vlc, 'Dark S01E03.mkv - VLC media player', kind)).toBe(FILM);
  expect(await pathFromCommandLine(vlc, 'Dark S01E03 - VLC media player', kind)).toBe(FILM);
  expect(await pathFromCommandLine('notepad.exe C:\\a.txt', 'b.txt - Notepad', kind)).toBeNull(); // name not in title
  expect(await pathFromCommandLine('notepad.exe a.txt', 'a.txt - Notepad', kind)).toBeNull(); // relative
  expect(await pathFromCommandLine('notepad.exe C:\\gone.txt', 'gone.txt - Notepad', kind)).toBeNull(); // missing
  expect(await pathFromCommandLine('C:\\a.txt', 'a.txt - Notepad', kind)).toBeNull(); // the exe itself never counts
  expect(await pathFromCommandLine('code.exe C:\\proj', 'x.ts - proj - Visual Studio Code', kind)).toBeNull(); // a folder
});

it('Explorer: the tab whose name is the title (Windows 11 tabs share one window)', () => {
  const tabs = [
    { path: 'C:\\Users\\me\\Documents', name: 'Documents' },
    { path: 'C:\\Users\\me\\Downloads', name: 'Downloads' },
  ];
  expect(pickExplorerTab(tabs, 'Downloads - File Explorer')).toBe('C:\\Users\\me\\Downloads');
  expect(pickExplorerTab(tabs, 'Pictures - File Explorer')).toBeNull();
  expect(pickExplorerTab([tabs[0]], 'Something else')).toBe('C:\\Users\\me\\Documents'); // one tab: that one
});

it('Explorer: reads the tabs of that window, keeps an existing folder', async () => {
  const run = vi.fn(async () => ({ tabs: [{ path: 'C:\\Users\\me\\Downloads', name: 'Downloads' }] }));
  expect(await readFilePath(cap('explorer.exe', 'Downloads - File Explorer'), run, kind)).toEqual({ path: 'C:\\Users\\me\\Downloads' });
  expect(run).toHaveBeenCalledWith(expect.any(String), { VN_HWND: '7' });
  const virtual = async () => ({ tabs: { path: '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}', name: 'This PC' } });
  expect(await readFilePath(cap('explorer.exe', 'This PC - File Explorer'), virtual, kind)).toBeNull();
  const gone = async () => ({ tabs: [{ path: 'C:\\X', name: 'X' }] });
  expect(await readFilePath(cap('explorer.exe', 'X - File Explorer'), gone, kind)).toBeNull();
});

it('Office: the window handle picks the document', () => {
  const docs = [
    { name: 'Notes.docx', fullName: 'C:\\Docs\\Notes.docx', hwnds: [5] },
    { name: 'Meeting Notes.docx', fullName: 'C:\\Docs\\Meeting Notes.docx', hwnds: [7] },
  ];
  expect(pickOfficeDoc(docs, 7, 'whatever - Word')).toBe('C:\\Docs\\Meeting Notes.docx');
});

it('Office without handles: the title must start with the name, never a part of another', () => {
  const docs = [
    { name: 'Notes.docx', fullName: 'C:\\Docs\\Notes.docx', hwnds: [] },
    { name: 'Meeting Notes.docx', fullName: 'C:\\Docs\\Meeting Notes.docx', hwnds: [] },
    { name: 'a.docx', fullName: 'C:\\Docs\\a.docx', hwnds: [] },
  ];
  expect(pickOfficeDoc(docs, 1, 'Meeting Notes.docx - Word')).toBe('C:\\Docs\\Meeting Notes.docx');
  expect(pickOfficeDoc(docs, 1, 'Meeting Notes - Word')).toBe('C:\\Docs\\Meeting Notes.docx');
  expect(pickOfficeDoc(docs, 1, 'Notes.docx [Compatibility Mode] - Word')).toBe('C:\\Docs\\Notes.docx');
  expect(pickOfficeDoc(docs, 1, 'banana.docx - Word')).toBeNull();
});

it('Office: the document path, or a link for OneDrive', async () => {
  const run = vi.fn(async () => ({ docs: { name: 'report.docx', fullName: 'C:\\Docs\\report.docx', hwnds: 7 } }));
  expect(await readFilePath(cap('WINWORD.EXE', 'report.docx - Word'), run, kind)).toEqual({ path: 'C:\\Docs\\report.docx' });
  expect(run).toHaveBeenCalledWith(expect.any(String), { VN_PROGID: 'Word.Application', VN_HWND: '7' });
  const sharepoint = async () => ({ docs: [{ name: 'b.xlsx', fullName: 'https://contoso.sharepoint.com/b.xlsx', hwnds: [7] }] });
  expect(await readFilePath(cap('EXCEL.EXE', 'b.xlsx - Excel'), sharepoint, kind)).toEqual({ url: 'https://contoso.sharepoint.com/b.xlsx' });
});

it('other apps: their command line', async () => {
  const run = vi.fn(async () => ({ commandLine: `vlc.exe "${FILM}"` }));
  expect(await readFilePath(cap('vlc.exe', 'Dark S01E03.mkv - VLC media player'), run, kind)).toEqual({ path: FILM });
  expect(run).toHaveBeenCalledWith(expect.any(String), { VN_PID: '9' });
});

it('never runs for a Chromium browser, and bad output gives null', async () => {
  const run = vi.fn(async () => ({ commandLine: 'x C:\\a.txt' }));
  expect(await readFilePath(cap('chrome.exe', 'a.txt'), run, kind)).toBeNull();
  expect(run).not.toHaveBeenCalled();
  for (const out of [null, 'x', { path: 5 }, { commandLine: null }, { tabs: 5 }, { docs: 'x' }])
    expect(await readFilePath(cap('notepad.exe', 'a.txt - Notepad'), async () => out, kind)).toBeNull();
});
