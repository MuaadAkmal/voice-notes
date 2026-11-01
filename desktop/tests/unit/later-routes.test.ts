import { expect, it } from 'vitest';
import type { LaterSite } from '../../src/shared/channels';
import { SettingsFieldSchemas } from '../../src/shared/ipc';
import {
  addSite,
  DEFAULT_LATER_SITES as SITES,
  isBuiltInSite,
  pageFor,
  pageForUrl,
  pageForWindow,
  siteHost,
  suggestedPage,
} from '../../src/shared/later-routes';

it.each([
  ['https://www.youtube.com/watch?v=x', 'YouTube'],
  ['https://music.youtube.com/watch?v=x', 'YouTube'],
  ['https://youtu.be/x', 'YouTube'],
  ['https://old.reddit.com/r/x/comments/1/a/', 'Reddit'],
  ['https://redd.it/abc', 'Reddit'],
  ['https://www.instagram.com/p/x/', 'Instagram'],
])('%s goes to %s', (url, page) => {
  expect(pageForUrl(url, SITES)).toBe(page);
});

it.each(['https://notreddit.com/r/x', 'https://reddit.com.evil.io/r/x', 'https://example.com/youtube.com', 'not a url'])(
  '%s has no page of its own',
  (url) => {
    expect(pageForUrl(url, SITES)).toBeNull();
  },
);

it.each([
  ['How Rust lifetimes work - YouTube - Google Chrome', 'chrome.exe', 'YouTube'],
  ['YouTube - Mozilla Firefox', 'firefox.exe', 'YouTube'],
  ['What is this? : r/rust - Google Chrome', 'chrome.exe', 'Reddit'],
  ['Reddit - The heart of the internet - Microsoft​ Edge', 'msedge.exe', 'Reddit'],
  ['Instagram - Brave', 'brave.exe', 'Instagram'],
  ['Someone on Instagram: "hello" - Google Chrome', 'chrome.exe', 'Instagram'],
])('the tab "%s" in %s is %s', (title, processName, page) => {
  expect(pageForWindow(title, processName, SITES)).toBe(page);
});

it.each([
  ['Why I quit YouTube - Medium - Google Chrome', 'chrome.exe'],
  ['Inbox (3) - Gmail - Google Chrome', 'chrome.exe'],
  ['YouTube - Notepad', 'notepad.exe'], // a file called YouTube, not the site
  ['r/rust notes - Word', 'winword.exe'],
])('the window "%s" in %s is no site', (title, processName) => {
  expect(pageForWindow(title, processName, SITES)).toBeNull();
});

const REDDIT_TAB = { title: 'A thread : r/rust - Google Chrome', processName: 'chrome.exe' };

it("the link's own site beats the tab it was dragged from", () => {
  expect(pageFor('https://youtu.be/x', REDDIT_TAB, SITES)).toBe('YouTube');
});

it('a link to anywhere else, or plain text, goes by the tab', () => {
  expect(pageFor('https://example.com/article', REDDIT_TAB, SITES)).toBe('Reddit');
  expect(pageFor(null, REDDIT_TAB, SITES)).toBe('Reddit');
});

it('with no known site at all there is no page', () => {
  expect(pageFor('https://example.com', null, SITES)).toBeNull();
  expect(pageFor(null, null, SITES)).toBeNull();
});

it('a site switched off matches nothing, by link or by tab', () => {
  const off = SITES.map((s) => (s.page === 'Reddit' ? { ...s, enabled: false } : s));
  expect(pageFor('https://redd.it/abc', REDDIT_TAB, off)).toBeNull();
  expect(pageFor('https://youtu.be/x', null, off)).toBe('YouTube');
});

it('a renamed page keeps its site, by link and by the name in the tab', () => {
  const renamed = SITES.map((s) => (s.page === 'YouTube' ? { ...s, page: 'Watch later' } : s));
  expect(pageFor('https://youtu.be/x', null, renamed)).toBe('Watch later');
  expect(pageFor(null, { title: 'A video - YouTube - Google Chrome', processName: 'chrome.exe' }, renamed)).toBe('Watch later');
});

it.each([
  ['https://www.github.com/a/b?c=d', 'github.com'],
  ['github.com', 'github.com'],
  ['  GIST.GitHub.com/x ', 'gist.github.com'],
  ['bbc.co.uk', 'bbc.co.uk'],
  ['example.com:8080/x', 'example.com'],
])('the site in %s is %s', (input, host) => {
  expect(siteHost(input)).toBe(host);
});

it.each(['', 'hello world', 'localhost', 'javascript:alert(1)', 'file:///c:/x.txt', 'http://192.168.0.1/admin', 'mailto:a@b.co'])(
  '"%s" is not a site',
  (input) => {
    expect(siteHost(input)).toBeNull();
  },
);

it('suggests a page name from the address', () => {
  expect(suggestedPage('github.com')).toBe('Github');
});

it('adds a site, on, under the name given or a suggested one', () => {
  const added = addSite(SITES, 'https://github.com/a/b', ' GitHub ')!;
  expect(added.at(-1)).toEqual({ page: 'GitHub', hosts: ['github.com'], enabled: true });
  expect(addSite(SITES, 'github.com', '')!.at(-1)!.page).toBe('Github');
  expect(pageForUrl('https://gist.github.com/x', added)).toBe('GitHub');
  expect(pageForWindow('a/b · GitHub - Google Chrome', 'chrome.exe', added)).toBe('GitHub');
  expect(isBuiltInSite(added.at(-1)!)).toBe(false);
});

it('refuses what is not a site, and one already listed', () => {
  expect(addSite(SITES, 'not a site', '')).toBeNull();
  expect(addSite(SITES, 'https://www.youtu.be/x', '')).toBeNull();
});

it('only the three starting sites count as built in', () => {
  expect(SITES.every(isBuiltInSite)).toBe(true);
});

const valid = (sites: unknown) => SettingsFieldSchemas.laterSites.safeParse(sites).success;
const site: LaterSite = { page: 'GitHub', hosts: ['github.com'], enabled: true };

it('the setting takes real sites and refuses anything malformed', () => {
  expect(valid(SITES)).toBe(true);
  expect(valid([site])).toBe(true);
  expect(valid([{ ...site, page: ' ' }])).toBe(false);
  expect(valid([{ ...site, hosts: [] }])).toBe(false);
  expect(valid([{ ...site, hosts: ['not a host'] }])).toBe(false);
  expect(valid('youtube.com')).toBe(false);
});
