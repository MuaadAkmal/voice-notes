import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SessionStore } from '../../src/main/account/session-store';
import type { Cipher } from '../../src/main/transcription/secrets';

// Reversible stand-in for safeStorage: the file must never hold the plain text.
const cipher: Cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from(s, 'utf8').reverse(),
  decrypt: (b) => Buffer.from(b).reverse().toString('utf8'),
};

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-session-'));
  file = path.join(dir, 'session.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

it('keeps values across instances, encrypted on disk', () => {
  new SessionStore(file, cipher).setItem('sb-auth-token', '{"access_token":"secret-token"}');
  expect(new SessionStore(file, cipher).getItem('sb-auth-token')).toBe('{"access_token":"secret-token"}');
  expect(fs.readFileSync(file).toString('latin1')).not.toContain('secret-token');
});

it('a missing key is null', () => {
  expect(new SessionStore(file, cipher).getItem('nope')).toBeNull();
});

it('a corrupt file, or one that will not decrypt, reads as signed out', () => {
  fs.writeFileSync(file, 'garbage');
  expect(new SessionStore(file, cipher).getItem('k')).toBeNull();
  const broken: Cipher = { ...cipher, decrypt: () => { throw new Error('DPAPI'); } };
  new SessionStore(file, cipher).setItem('k', 'v');
  expect(new SessionStore(file, broken).getItem('k')).toBeNull();
});

it('removeItem and clear forget values', () => {
  const s = new SessionStore(file, cipher);
  s.setItem('a', '1');
  s.setItem('b', '2');
  s.removeItem('a');
  expect(s.getItem('a')).toBeNull();
  expect(s.getItem('b')).toBe('2');
  s.clear();
  expect(new SessionStore(file, cipher).getItem('b')).toBeNull();
  expect(fs.existsSync(file)).toBe(false);
});
