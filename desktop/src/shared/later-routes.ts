import type { LaterSite } from './channels';

// Pure: which site's own page something saved for later belongs on. null = the Review later page.
// The sites are a setting (`laterSites`): these three to start with, and any the user adds.

export const DEFAULT_LATER_SITES: LaterSite[] = [
  { page: 'YouTube', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], enabled: true },
  { page: 'Reddit', hosts: ['reddit.com', 'redd.it'], enabled: true },
  { page: 'Instagram', hosts: ['instagram.com'], enabled: true },
];

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
export const isSiteHost = (host: string) => HOST.test(host);

/** How a built-in site's tabs read when its name isn't alone in the title. */
const TITLE_HINTS: Record<string, RegExp> = {
  'reddit.com': /(?:^|\s)r\/\w+/,
  'instagram.com': /\son Instagram\b/i,
};

const BROWSERS = new Set(['chrome', 'msedge', 'brave', 'vivaldi', 'opera', 'arc', 'firefox']);

export const isBuiltInSite = (site: LaterSite) => DEFAULT_LATER_SITES.some((d) => d.hosts[0] === site.hosts[0]);

/** "https://www.github.com/a/b" or "github.com" → "github.com"; null for anything that isn't a website. */
export function siteHost(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/:]+:\d/.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return isSiteHost(host) && !/^[\d.]+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

const label = (host: string) => host.split('.')[0];

/** "github.com" → "Github": a starting point the user can correct. */
export function suggestedPage(host: string): string {
  const name = label(host);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The list with a new site added, on, at the end; null when the input isn't a site or is already listed. */
export function addSite(sites: LaterSite[], input: string, page: string): LaterSite[] | null {
  const host = siteHost(input);
  if (!host || sites.some((s) => s.hosts.includes(host))) return null;
  return [...sites, { page: page.trim() || suggestedPage(host), hosts: [host], enabled: true }];
}

const on = (sites: LaterSite[]) => sites.filter((s) => s.enabled);

/** The site a link is on, by its real host: `notreddit.com` and `reddit.com.evil.io` aren't Reddit. */
export function pageForUrl(url: string, sites: LaterSite[]): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return on(sites).find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)))?.page ?? null;
}

/**
 * The site in a browser's tab, by its window title: "Some video - YouTube - Google Chrome". The name
 * must stand alone between separators, so "Why I quit YouTube - Medium" isn't YouTube. Its page name
 * counts as well as its address's name, since a Reddit page may be called "Threads". Browsers only:
 * in any other app a title is a file or a chat, not a site.
 */
export function pageForWindow(title: string, processName: string, sites: LaterSite[]): string | null {
  if (!BROWSERS.has(processName.toLowerCase().replace(/\.exe$/, ''))) return null;
  const segments = title.split(/\s[-–—|•·]\s/).map((s) => s.trim().toLowerCase());
  const named = (s: LaterSite) => [s.page.toLowerCase(), ...s.hosts.map(label)].some((n) => segments.includes(n));
  return on(sites).find((s) => named(s) || s.hosts.some((h) => TITLE_HINTS[h]?.test(title)))?.page ?? null;
}

/** The link's own site wins (a YouTube link dragged out of Reddit is YouTube); then the tab it came from. */
export function pageFor(
  url: string | null | undefined,
  win: { title: string; processName: string } | null,
  sites: LaterSite[],
): string | null {
  return (url ? pageForUrl(url, sites) : null) ?? (win ? pageForWindow(win.title, win.processName, sites) : null);
}
