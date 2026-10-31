// Seals refresh tokens before they reach the database: AES-256-GCM with the function's CONNECTORS_KEY.
// WebCrypto only, so the same file runs in Deno (the function) and in Node (the tests).

export type TokenCipher = { encrypt(plain: string): Promise<string>; decrypt(sealed: string): Promise<string> };

const IV_BYTES = 12;

export async function aesGcmCipher(keyBase64: string): Promise<TokenCipher> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromBase64(keyBase64);
  } catch {
    raw = new Uint8Array();
  }
  if (raw.length !== 32) throw new Error('CONNECTORS_KEY must be 32 bytes');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    async encrypt(plain) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
      const out = new Uint8Array(IV_BYTES + ct.length);
      out.set(iv);
      out.set(ct, IV_BYTES);
      return toBase64(out);
    },
    async decrypt(sealed) {
      const bytes = fromBase64(sealed);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) }, key, bytes.slice(IV_BYTES));
      return new TextDecoder().decode(plain);
    },
  };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
