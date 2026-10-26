import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

/** Small key/value facts about this PC's sync, in the sync_state table. */
export class SyncState {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly hostname: () => string,
  ) {}

  private get(key: string): string | undefined {
    const row = this.sqlite.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private set(key: string, value: string): void {
    this.sqlite
      .prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  private getOrCreate(key: string, make: () => string): string {
    const found = this.get(key);
    if (found !== undefined) return found;
    const value = make();
    this.set(key, value);
    return value;
  }

  /** Identifies this PC to the server; made on first use, never changes. */
  deviceId(): string {
    return this.getOrCreate('device_id', randomUUID);
  }

  /** Shown in conflict copies, e.g. "Notes (conflict, LAPTOP-1)". */
  deviceName(): string {
    return this.getOrCreate('device_name', this.hostname);
  }

  /** The last server version pulled. */
  cursor(): number {
    return Number(this.get('cursor') ?? 0);
  }

  setCursor(n: number): void {
    this.set('cursor', String(n));
  }

  enabled(): boolean {
    return this.get('enabled') === '1';
  }

  setEnabled(on: boolean): void {
    this.set('enabled', on ? '1' : '0');
  }
}
