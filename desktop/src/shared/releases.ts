/** The website's "What's new" page (web/src/app/releases); each version has its own anchor there. */
export const RELEASES_URL = 'https://voicenote.cloud/releases';

/** The notes for `version`, or the page's top when it isn't known. */
export const releaseNotesUrl = (version?: string | null): string => (version ? `${RELEASES_URL}#${version}` : RELEASES_URL);
