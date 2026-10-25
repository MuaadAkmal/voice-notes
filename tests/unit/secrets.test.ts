import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Cipher, Secrets } from '../../src/main/transcription/secrets';

const fakeCipher = (available = true): Cipher => ({
  available: () => available,
  encrypt: (s) => Buffer.from(`enc:${s}`),
  decrypt: (b) => {
    const s = b.toString();
    if (!s.startsWith('enc:')) throw new Error('bad ciphertext');
    return s.slice(4);
  },
});

let file: string;
beforeEach(() => {
  file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'vn-secrets-')),
    'secrets.json',
  );
});

it('saves a trimmed key without writing it in clear', () => {
  const s = new Secrets(file, fakeCipher());
  s.set('server', '  sk-abcd1234\n');
  expect(s.get('server')).toBe('sk-abcd1234');
  expect(s.info('server')).toEqual({ saved: true, last4: '1234' });
  expect(fs.readFileSync(file, 'utf8')).not.toContain('sk-abcd1234');
  expect(new Secrets(file, fakeCipher()).get('server')).toBe('sk-abcd1234');
});

it('removes a key', () => {
  const s = new Secrets(file, fakeCipher());
  s.set('server', 'sk-1');
  s.remove('server');
  expect(s.get('server')).toBeNull();
  expect(s.info('server')).toEqual({ saved: false, last4: '' });
});

it('refuses to save when encryption is unavailable', () => {
  const s = new Secrets(file, fakeCipher(false));
  expect(() => s.set('server', 'sk-1')).toThrow(
    "Can't store keys securely on this system",
  );
  expect(fs.existsSync(file)).toBe(false);
});

it('treats a corrupt file or undecryptable key as no key', () => {
  fs.writeFileSync(file, '{oops');
  expect(new Secrets(file, fakeCipher()).get('server')).toBeNull();
  fs.writeFileSync(
    file,
    JSON.stringify({ server: Buffer.from('garbage').toString('base64') }),
  );
  const s = new Secrets(file, fakeCipher());
  expect(s.get('server')).toBeNull();
  expect(s.info('server')).toEqual({ saved: false, last4: '' });
});
