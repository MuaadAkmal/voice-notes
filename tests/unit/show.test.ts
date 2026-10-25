import { expect, it } from 'vitest';
import { showFromTitle } from '../../src/shared/show';

it.each([
  ['La Casa de Papel | Netflix - Google Chrome', 'chrome.exe', 'La Casa de Papel'],
  ['(3) Learn Spanish with Dark - YouTube - Google Chrome', 'chrome.exe', 'Learn Spanish with Dark'],
  ['Dark | Netflix and 2 more pages - Personal - Microsoft​ Edge', 'msedge.exe', 'Dark'],
  ['Amélie — Mozilla Firefox', 'firefox.exe', 'Amélie'],
  ['Watch Money Heist | Prime Video - Brave', 'brave.exe', 'Watch Money Heist'],
  ['La.Casa.De.Papel.S01E03.1080p.WEB-DL.x264.mkv - VLC media player', 'vlc.exe', 'La Casa De Papel S01E03'],
  ['Le_Fabuleux_Destin.mp4 - mpv', 'mpv.exe', 'Le Fabuleux Destin'],
  ['Shōgun', 'Netflix.exe', 'Shōgun'],
])('%s → %s', (title, process, show) => {
  expect(showFromTitle(title, process)).toBe(show);
});

it.each([
  ['Netflix - Google Chrome', 'chrome.exe'],
  ['YouTube', 'msedge.exe'],
  ['New Tab - Google Chrome', 'chrome.exe'],
  ['', 'chrome.exe'],
  ['Document1 - Word', 'WINWORD.EXE'], // not a browser or player: no show label
  ['index.ts - whisperflow - Visual Studio Code', 'Code.exe'],
])('%s gives no show', (title, process) => {
  expect(showFromTitle(title, process)).toBeNull();
});

it('caps very long labels', () => {
  expect(showFromTitle(`${'a'.repeat(300)} - Google Chrome`, 'chrome.exe')).toHaveLength(120);
});
