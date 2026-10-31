import fs from 'node:fs';
import type { Cipher } from '../transcription/secrets';

/**
 * Where supabase-js keeps the sign-in session: one file, encrypted as a whole (DPAPI via safeStorage),
 * so only this Windows user on this PC can read it. Anything unreadable counts as signed out.
 */
export class SessionStore {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  getItem(key: string): string | null {
    return this.read()[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.write({ ...this.read(), [key]: value });
  }

  removeItem(key: string): void {
    const { [key]: _gone, ...rest } = this.read();
    this.write(rest);
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
  }

  private read(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(this.cipher.decrypt(fs.readFileSync(this.file)));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private write(map: Record<string, string>): void {
    fs.writeFileSync(`${this.file}.tmp`, this.cipher.encrypt(JSON.stringify(map)));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}
