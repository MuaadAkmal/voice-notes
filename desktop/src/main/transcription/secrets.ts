import fs from 'node:fs';
import { safeStorage } from 'electron';
import type { KeyInfo } from '../../shared/channels';

export type Cipher = {
  available(): boolean;
  encrypt(s: string): Buffer;
  decrypt(b: Buffer): string;
};

/** Windows DPAPI via Electron: only this user on this machine can decrypt. */
export const safeStorageCipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
};

type Provider = 'server';

/** API keys, encrypted, in their own file: never in settings.json and never sent to a renderer. */
export class Secrets {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  get(provider: Provider): string | null {
    const stored = this.read()[provider];
    if (typeof stored !== 'string') return null;
    try {
      return this.cipher.decrypt(Buffer.from(stored, 'base64'));
    } catch {
      return null; // another user's or machine's ciphertext
    }
  }

  set(provider: Provider, key: string): void {
    if (!this.cipher.available())
      throw new Error("Can't store keys securely on this system");
    this.write({
      ...this.read(),
      [provider]: this.cipher.encrypt(key.trim()).toString('base64'),
    });
  }

  remove(provider: Provider): void {
    const { [provider]: _removed, ...rest } = this.read();
    this.write(rest);
  }

  info(provider: Provider): KeyInfo {
    const key = this.get(provider);
    return key
      ? { saved: true, last4: key.slice(-4) }
      : { saved: false, last4: '' };
  }

  private read(): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private write(data: Record<string, unknown>): void {
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(data, null, 2));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}
