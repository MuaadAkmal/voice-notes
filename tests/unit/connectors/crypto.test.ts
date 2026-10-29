import { expect, it } from 'vitest';
import { aesGcmCipher } from '../../../src/shared/connectors/crypto';

const KEY = Buffer.alloc(32, 7).toString('base64');

it('round trips', async () => {
  const c = await aesGcmCipher(KEY);
  expect(await c.decrypt(await c.encrypt('1//refresh-token'))).toBe('1//refresh-token');
});

it('two encryptions of the same text differ', async () => {
  const c = await aesGcmCipher(KEY);
  expect(await c.encrypt('x')).not.toBe(await c.encrypt('x'));
});

it('a key that is not 32 bytes throws', async () => {
  await expect(aesGcmCipher(Buffer.alloc(16).toString('base64'))).rejects.toThrow('CONNECTORS_KEY must be 32 bytes');
  await expect(aesGcmCipher('not base64 !!')).rejects.toThrow('CONNECTORS_KEY must be 32 bytes');
});

it('tampered ciphertext is rejected', async () => {
  const c = await aesGcmCipher(KEY);
  const sealed = Buffer.from(await c.encrypt('secret'), 'base64');
  sealed[sealed.length - 1] ^= 1;
  await expect(c.decrypt(sealed.toString('base64'))).rejects.toThrow();
});
