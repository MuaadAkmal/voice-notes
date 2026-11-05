import { expect, it } from 'vitest';
import { RELEASES_URL, releaseNotesUrl } from '../../src/shared/releases';

it("links to a version's notes on the website, or the page when there's no version", () => {
  expect(releaseNotesUrl('3.8.2')).toBe('https://voicenote.cloud/releases#3.8.2');
  expect(releaseNotesUrl(null)).toBe(RELEASES_URL);
  expect(releaseNotesUrl()).toBe(RELEASES_URL);
});
