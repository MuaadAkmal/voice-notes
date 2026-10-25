// Browsers and media players whose window title names what's playing. Other apps (Word, VS Code…)
// keep their raw window title on the note but get no show label.
const MEDIA_HOSTS = new Set([
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'librewolf', 'waterfox', 'zen',
  'vlc', 'mpv', 'potplayer', 'potplayermini', 'potplayermini64', 'mpc-hc', 'mpc-hc64', 'mpc-be', 'mpc-be64',
  'wmplayer', 'kmplayer', 'gom', 'plex', 'jellyfin', 'netflix', 'primevideo', 'disneyplus',
  'applicationframehost', // UWP apps (Netflix, Movies & TV) run inside this host
]);

const SEP = String.raw`\s[-—–|·]\s`;
const PRIVATE = String.raw`(?:\s+Private Browsing|\s*\(Incognito\))?`;
const BROWSER = new RegExp(
  `${SEP}(?:(?:Personal|Work|Profile \\d+)${SEP})?` +
    String.raw`(?:Google Chrome|Mozilla Firefox|Firefox|Brave|Opera|Vivaldi|Arc|LibreWolf|Waterfox|Zen Browser)${PRIVATE}$`,
  'i',
);
// Edge puts any profile name (or "InPrivate") before its own name: "Dark - Muaad (Uni) - Microsoft Edge".
const EDGE = new RegExp(String.raw`${SEP}(?:[^-—–|·]{1,40}${SEP})?Microsoft[\s​]*Edge$`, 'i');
const MORE_PAGES = /\s+and \d+ more pages?$/i;
const SITES = String.raw`Netflix|YouTube|Prime Video|Amazon Prime Video|Disney\+|Crunchyroll|HBO Max|Max|Hulu|Apple TV\+?|Twitch|Rakuten Viki|Viki|Plex|Jellyfin|Kanopy|MUBI|Peacock|Paramount\+|RTVE Play|Arte|Tubi`;
const SITE_SUFFIX = new RegExp(`\\s*[-—–|·]\\s*(?:${SITES})$`, 'i');
const SITE_ONLY = new RegExp(`^(?:${SITES})$`, 'i');
const PLAYER = /\s[-—–]\s(?:VLC media player|mpv|PotPlayer|MPC-HC|MPC-BE|Windows Media Player|Media Player|Movies & TV|KMPlayer|GOM Player)$/i;
const MEDIA_FILE = /\.(?:mkv|mp4|avi|webm|mov|m4v|wmv|flv|ts|mp3|m4a|flac|ogg|opus)$/i;
const RELEASE_TAGS = /\s+(?:2160p|1080p|720p|480p|4k|x26[45]|h\.?26[45]|hevc|web-?dl|webrip|bluray|brrip|hdrip|dvdrip)\b.*$/i;
const NOTIFICATION_COUNT = /^\(\d+\+?\)\s*/;
const PLACEHOLDERS = /^(?:new tab|start|home|untitled|loading…?|about:blank)$/i;
const MAX_LEN = 120;

/** "La Casa de Papel | Netflix - Google Chrome" → "La Casa de Papel"; null when the title names no show. */
export function showFromTitle(title: string, processName: string): string | null {
  if (!MEDIA_HOSTS.has(processName.toLowerCase().replace(/\.exe$/, ''))) return null;
  let s = title.trim().replace(BROWSER, '').replace(EDGE, '').replace(MORE_PAGES, '');
  s = s.replace(SITE_SUFFIX, '').replace(PLAYER, '');
  if (MEDIA_FILE.test(s)) {
    s = s.replace(MEDIA_FILE, '');
    // Release filenames use dots/underscores for spaces: La.Casa.De.Papel.S01E03.1080p
    if (!s.includes(' ')) s = s.replace(/[._]+/g, ' ');
    s = s.replace(RELEASE_TAGS, '');
  }
  s = s.replace(NOTIFICATION_COUNT, '').trim();
  if (!s || SITE_ONLY.test(s) || PLACEHOLDERS.test(s)) return null;
  return s.slice(0, MAX_LEN);
}
