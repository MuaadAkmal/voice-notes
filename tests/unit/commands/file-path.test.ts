import { expect, it, vi } from 'vitest';
import type { Capture } from '../../../src/main/commands/capture';
import { pathFromCommandLine, readFilePath, splitCommandLine } from '../../../src/main/commands/file-path';

const FILM = 'C:\\Films\\Dark S01E03.mkv';
const ex = (p: string) => [FILM, 'C:\\a.txt', 'C:\\Users\\me\\Downloads', 'C:\\Docs\\report.docx'].includes(p);
const cap = (processName: string, title: string): Capture => ({ hwnd: 7, title, processName, pid: 9 });

it('splits a Windows command line', () => {
  expect(splitCommandLine(`"C:\\Program Files\\VLC\\vlc.exe" --x "${FILM}" b`)).toEqual([
    'C:\\Program Files\\VLC\\vlc.exe',
    '--x',
    FILM,
    'b',
  ]);
});

it('command line rule: an existing absolute file named in the title', () => {
  const vlc = `"C:\\Program Files\\VLC\\vlc.exe" --started-from-file "${FILM}"`;
  expect(pathFromCommandLine(vlc, 'Dark S01E03.mkv - VLC media player', ex)).toBe(FILM);
  expect(pathFromCommandLine(vlc, 'Dark S01E03 - VLC media player', ex)).toBe(FILM);
  expect(pathFromCommandLine('notepad.exe C:\\a.txt', 'b.txt - Notepad', ex)).toBeNull(); // name not in title
  expect(pathFromCommandLine('notepad.exe a.txt', 'a.txt - Notepad', ex)).toBeNull(); // relative
  expect(pathFromCommandLine('notepad.exe C:\\gone.txt', 'gone.txt - Notepad', ex)).toBeNull(); // missing
  expect(pathFromCommandLine('C:\\a.txt', 'a.txt - Notepad', ex)).toBeNull(); // the exe itself never counts
});

it('Explorer: the folder of that window', async () => {
  const run = vi.fn(async () => ({ path: 'C:\\Users\\me\\Downloads' }));
  expect(await readFilePath(cap('explorer.exe', 'Downloads - File Explorer'), run, ex)).toEqual({ path: 'C:\\Users\\me\\Downloads' });
  expect(run).toHaveBeenCalledWith(expect.any(String), { VN_HWND: '7' });
});

it('Explorer: a virtual folder or a path that is gone gives null', async () => {
  expect(await readFilePath(cap('explorer.exe', 'This PC'), async () => ({ path: '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}' }), ex)).toBeNull();
  expect(await readFilePath(cap('explorer.exe', 'X'), async () => ({ path: 'C:\\X' }), ex)).toBeNull();
});

it('Office: the document path, or a link for OneDrive', async () => {
  const run = vi.fn(async () => ({ path: 'C:\\Docs\\report.docx' }));
  expect(await readFilePath(cap('WINWORD.EXE', 'report.docx - Word'), run, ex)).toEqual({ path: 'C:\\Docs\\report.docx' });
  expect(run).toHaveBeenCalledWith(expect.any(String), { VN_PROGID: 'Word.Application', VN_TITLE: 'report.docx - Word' });
  const sharepoint = async () => ({ path: 'https://contoso.sharepoint.com/b.xlsx' });
  expect(await readFilePath(cap('EXCEL.EXE', 'b.xlsx - Excel'), sharepoint, ex)).toEqual({ url: 'https://contoso.sharepoint.com/b.xlsx' });
});

it('other apps: their command line', async () => {
  const run = vi.fn(async () => ({ commandLine: `vlc.exe "${FILM}"` }));
  expect(await readFilePath(cap('vlc.exe', 'Dark S01E03.mkv - VLC media player'), run, ex)).toEqual({ path: FILM });
  expect(run).toHaveBeenCalledWith(expect.any(String), { VN_PID: '9' });
});

it('never runs for a Chromium browser, and bad output gives null', async () => {
  const run = vi.fn(async () => ({ path: 'C:\\a.txt' }));
  expect(await readFilePath(cap('chrome.exe', 'a.txt'), run, ex)).toBeNull();
  expect(run).not.toHaveBeenCalled();
  for (const out of [null, 'x', { path: 5 }, { commandLine: null }])
    expect(await readFilePath(cap('notepad.exe', 'a.txt - Notepad'), async () => out, ex)).toBeNull();
});
