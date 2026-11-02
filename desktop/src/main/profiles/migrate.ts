import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { splitSettings } from '../settings';
import { profileDir, UNCLAIMED } from './paths';

const DB = 'voice-notes.sqlite';
/** What moves into the profile, as it sat at the root before profiles. */
const MOVED = [DB, `${DB}-wal`, `${DB}-shm`, 'recordings', 'images'];
/** Written first, removed last: the owner picked by a run that was interrupted. */
const MARKER = 'migrating-to';

/** A library from before profiles is still at the root (or a move was interrupted). */
export function needsMigration(root: string): boolean {
  return [DB, 'settings.json', MARKER].some((f) => fs.existsSync(path.join(root, f)));
}

/** The account a pre-profiles database synced with, or null (no sync_state table, never synced, unreadable). */
export function readAccountId(dbFile: string): string | null {
  try {
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("SELECT value FROM sync_state WHERE key = 'account_id'").get() as { value: string } | undefined;
      return row?.value || null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Moves the root-level library into its owner's profile: the account it syncs with, else the signed-in user,
 * else unclaimed (the first account to sign in gets it). Every step is skipped once done, so an interrupted
 * run finishes on the next start; nothing already in the profile is overwritten. Returns the owner, or null.
 */
export function migrateToProfiles(root: string, sessionUserId: string | null): string | null {
  if (!needsMigration(root)) return null;
  const at = (f: string) => path.join(root, f);
  const owner = readMarker(at(MARKER)) ?? readAccountId(at(DB)) ?? sessionUserId ?? UNCLAIMED;
  fs.writeFileSync(at(MARKER), owner);
  const dir = profileDir(root, owner);
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(at('settings.json'))) {
    const { pc, profile } = splitSettings(readJson(at('settings.json')));
    writeJson(at('pc.json'), { ...readJson(at('pc.json')), ...pc });
    if (!fs.existsSync(path.join(dir, 'profile.json'))) writeJson(path.join(dir, 'profile.json'), profile);
  }
  for (const f of MOVED) if (fs.existsSync(at(f)) && !fs.existsSync(path.join(dir, f))) fs.renameSync(at(f), path.join(dir, f));

  fs.rmSync(at('settings.json'), { force: true });
  fs.rmSync(at(MARKER), { force: true });
  return owner;
}

function readMarker(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function readJson(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}
