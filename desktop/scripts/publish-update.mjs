// Puts the build from `npm run make` where installed apps look for updates (UPDATE_FEED_URL).
// RELEASES goes last: it's what announces a version, so its files are all there by then.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BUCKET = 'voice-note-updates';
const PREFIX = 'win32/x64';
const FEED = 'https://updates.voicenote.cloud/win32/x64';
const OUT = path.resolve('out/make/squirrel.windows/x64');

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const force = process.argv.includes('--force');
const fail = (message) => {
  console.error(`publish-update: ${message}`);
  process.exit(1);
};

const nupkg = `voice_notes-${version}-full.nupkg`;
const setup = `Voice Notes-${version} Setup.exe`;
for (const name of [nupkg, setup, 'RELEASES']) {
  if (!fs.existsSync(path.join(OUT, name))) fail(`${name} is missing; run npm run make first`);
}
if (!fs.readFileSync(path.join(OUT, 'RELEASES'), 'utf8').includes(nupkg)) fail(`RELEASES doesn't name ${nupkg}; rebuild`);

// Publishing an older or equal version would strand or confuse installed apps.
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const live = await fetch(`${FEED}/RELEASES`, { cache: 'no-store' });
if (live.ok) {
  const current = (await live.text()).match(/voice_notes-(\d+\.\d+\.\d+)-full\.nupkg/)?.[1];
  if (current && !newer(version, current) && !force) fail(`the feed already has ${current}; bump the version (or --force)`);
} else if (live.status !== 404) {
  fail(`could not read the feed (HTTP ${live.status})`);
}

const put = (file, key, contentType, cacheControl) => {
  console.log(`Uploading ${key}`);
  execSync(
    `npx wrangler@4 r2 object put "${BUCKET}/${key}" --remote --file "${file}" --content-type "${contentType}" --cache-control "${cacheControl}"`,
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
};
const FOREVER = 'public, max-age=31536000, immutable'; // a version's files never change
const BRIEF = 'public, max-age=60';

put(path.join(OUT, nupkg), `${PREFIX}/${nupkg}`, 'application/octet-stream', FOREVER);
put(path.join(OUT, setup), `${PREFIX}/VoiceNotes-${version}-Setup.exe`, 'application/vnd.microsoft.portable-executable', FOREVER);
// A fixed address for the website's download button.
put(path.join(OUT, setup), `${PREFIX}/VoiceNotes-Setup.exe`, 'application/vnd.microsoft.portable-executable', BRIEF);
put(path.join(OUT, 'RELEASES'), `${PREFIX}/RELEASES`, 'text/plain', BRIEF);

const check = await fetch(`${FEED}/RELEASES`, { cache: 'no-store' });
const text = check.ok ? await check.text() : '';
console.log(text.includes(nupkg) ? `Published ${version}: ${FEED}` : `Uploaded ${version}, but the feed doesn't show it yet; check ${FEED}/RELEASES`);
