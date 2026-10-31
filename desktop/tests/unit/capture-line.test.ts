import { expect, it } from 'vitest';
import { appName, captureLabel, captureLine, isChromium, normaliseUrl } from '../../src/shared/capture-line';

it('labels the window by what it shows', () => {
  expect(captureLabel('How Rust lifetimes work - YouTube - Google Chrome', 'chrome.exe')).toBe('How Rust lifetimes work');
  expect(captureLabel('report.docx - Word', 'WINWORD.EXE')).toBe('report.docx');
  expect(captureLabel('main.ts - whisperflow - Visual Studio Code', 'Code.exe')).toBe('main.ts - whisperflow');
  expect(captureLabel('Downloads - File Explorer', 'explorer.exe')).toBe('Downloads');
  expect(captureLabel('Word', 'WINWORD.EXE')).toBe('Word');
});

it('caps a long label at 120 chars', () => {
  const label = captureLabel('x'.repeat(200), 'foo.exe');
  expect(label).toHaveLength(120);
  expect(label.endsWith('…')).toBe(true);
});

it('names apps', () => {
  expect(appName('msedge.exe')).toBe('Edge');
  expect(appName('WINWORD.EXE')).toBe('Word');
  expect(appName('vlc.exe')).toBe('VLC');
  expect(appName('Code.exe')).toBe('VS Code');
  expect(appName('explorer.exe')).toBe('File Explorer');
  expect(appName('Spotify.exe')).toBe('Spotify');
});

it('knows Chromium browsers', () => {
  expect(isChromium('chrome.exe')).toBe(true);
  expect(isChromium('MSEDGE.EXE')).toBe(true);
  expect(isChromium('brave.exe')).toBe(true);
  expect(isChromium('firefox.exe')).toBe(false);
});

it('normalises address bar text to a url', () => {
  expect(normaliseUrl('youtube.com/watch?v=x')).toBe('https://youtube.com/watch?v=x');
  expect(normaliseUrl(' http://localhost:3000/a ')).toBe('http://localhost:3000/a');
  expect(normaliseUrl('https://www.reddit.com/r/ramen/')).toBe('https://www.reddit.com/r/ramen/');
});

it('normaliseUrl rejects what is not a web address', () => {
  for (const s of ['chrome://newtab', 'about:blank', 'how to cook rice', '', 'edge://settings', `https://${'a'.repeat(2000)}.com`])
    expect(normaliseUrl(s)).toBeNull();
});

it('builds each line shape', () => {
  expect(captureLine({ label: 'Video', app: 'Chrome', url: 'https://y.com/w?v=1' })).toBe('[Video](https://y.com/w?v=1)');
  expect(captureLine({ label: 'report.docx', app: 'Word', path: 'C:\\Docs\\report.docx' })).toBe('report.docx (Word) · `C:\\Docs\\report.docx`');
  expect(captureLine({ label: 'Dark S01E03', app: 'VLC', imageSrc: 'vn-image://u.jpg' })).toBe('Dark S01E03 (VLC) ![Dark S01E03](vn-image://u.jpg)');
  expect(captureLine({ label: 'Dark', app: 'VLC' })).toBe('Dark (VLC)');
  expect(captureLine({ label: 'Spotify', app: 'Spotify' })).toBe('Spotify');
});

it('escapes link syntax', () => {
  expect(captureLine({ label: 'a [b] \\c', app: 'Chrome', url: 'https://x.com/a (b)/c d' })).toBe(
    '[a \\[b\\] \\\\c](https://x.com/a%20%28b%29/c%20d)',
  );
  expect(captureLine({ label: 'f', app: 'Notepad', path: 'C:\\we`ird.txt' })).toBe('f (Notepad) · C:\\we`ird.txt');
  expect(captureLine({ label: 'a\nb', app: 'VLC' })).toBe('a b (VLC)');
});

it('escapes the label in every shape, so a page title cannot make a link or a checkbox', () => {
  expect(captureLine({ label: 'x [click](https://e.com)', app: 'Firefox' })).toBe('x \\[click\\](https://e.com) (Firefox)');
  expect(captureLine({ label: '[ ] task', app: 'Firefox', imageSrc: 'vn-image://u.jpg' })).toBe(
    '\\[ \\] task (Firefox) ![\\[ \\] task](vn-image://u.jpg)',
  );
  expect(captureLine({ label: 'a [b]', app: 'Word', path: 'C:\\a.docx' })).toBe('a \\[b\\] (Word) · `C:\\a.docx`');
});
