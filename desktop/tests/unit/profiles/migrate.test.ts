import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, expect, it } from 'vitest';
import { migrateToProfiles, needsMigration } from '../../../src/main/profiles/migrate';
import { profileDir, UNCLAIMED } from '../../../src/main/profiles/paths';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-migrate-'));
});

const at = (...p: string[]) => path.join(root, ...p);
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

/** A root-level library as before profiles: database (optionally synced with `account`), a recording, an image. */
function oldLibrary(account?: string) {
  const db = new Database(at('voice-notes.sqlite'));
  if (account !== undefined) {
    db.exec('CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare("INSERT INTO sync_state (key, value) VALUES ('account_id', ?)").run(account);
  } else db.exec('CREATE TABLE notes (id TEXT)');
  db.close();
  fs.mkdirSync(at('recordings'));
  fs.writeFileSync(at('recordings', 'n1.webm'), 'audio');
  fs.mkdirSync(at('images'));
  fs.writeFileSync(at('images', 'i1.png'), 'img');
}

it('the synced account owns it', () => {
  oldLibrary('acc');
  expect(migrateToProfiles(root, 'other')).toBe('acc');
  expect(fs.existsSync(path.join(profileDir(root, 'acc'), 'voice-notes.sqlite'))).toBe(true);
  expect(fs.readFileSync(path.join(profileDir(root, 'acc'), 'recordings', 'n1.webm'), 'utf8')).toBe('audio');
  expect(fs.readFileSync(path.join(profileDir(root, 'acc'), 'images', 'i1.png'), 'utf8')).toBe('img');
  expect(fs.existsSync(at('voice-notes.sqlite'))).toBe(false);
  expect(needsMigration(root)).toBe(false);
});

it('else the signed-in user', () => {
  oldLibrary();
  expect(migrateToProfiles(root, 'me')).toBe('me');
  expect(fs.existsSync(path.join(profileDir(root, 'me'), 'recordings', 'n1.webm'))).toBe(true);
});

it('else unclaimed', () => {
  oldLibrary();
  expect(migrateToProfiles(root, null)).toBe(UNCLAIMED);
  expect(fs.existsSync(path.join(profileDir(root, UNCLAIMED), 'voice-notes.sqlite'))).toBe(true);
});

it('settings are split', () => {
  oldLibrary('acc');
  fs.writeFileSync(at('settings.json'), JSON.stringify({ theme: 'dark', homeWidgets: [] }));
  migrateToProfiles(root, null);
  expect(readJson(at('pc.json'))).toEqual({ theme: 'dark' });
  expect(readJson(path.join(profileDir(root, 'acc'), 'profile.json'))).toEqual({ homeWidgets: [] });
  expect(fs.existsSync(at('settings.json'))).toBe(false);
});

it('resumes after an interrupted run', () => {
  oldLibrary('acc');
  fs.writeFileSync(at('settings.json'), JSON.stringify({ theme: 'dark' }));
  fs.mkdirSync(profileDir(root, 'acc'), { recursive: true });
  fs.renameSync(at('recordings'), path.join(profileDir(root, 'acc'), 'recordings')); // stopped after one move
  expect(needsMigration(root)).toBe(true);
  migrateToProfiles(root, null);
  expect(fs.existsSync(path.join(profileDir(root, 'acc'), 'voice-notes.sqlite'))).toBe(true);
  expect(fs.existsSync(path.join(profileDir(root, 'acc'), 'images', 'i1.png'))).toBe(true);
  expect(fs.existsSync(path.join(profileDir(root, 'acc'), 'recordings', 'n1.webm'))).toBe(true);
  expect(needsMigration(root)).toBe(false);
});

it('resumes when only settings.json was left', () => {
  fs.writeFileSync(at('settings.json'), JSON.stringify({ theme: 'dark', laterPageId: null }));
  expect(needsMigration(root)).toBe(true);
  migrateToProfiles(root, 'me');
  expect(readJson(at('pc.json'))).toEqual({ theme: 'dark' });
  expect(readJson(path.join(profileDir(root, 'me'), 'profile.json'))).toEqual({ laterPageId: null });
});

it('never overwrites', () => {
  oldLibrary('acc');
  fs.mkdirSync(path.join(profileDir(root, 'acc'), 'images'), { recursive: true });
  fs.writeFileSync(path.join(profileDir(root, 'acc'), 'images', 'keep.png'), 'k');
  fs.writeFileSync(path.join(profileDir(root, 'acc'), 'profile.json'), JSON.stringify({ homeWidgets: [] }));
  fs.writeFileSync(at('settings.json'), JSON.stringify({ transcribeLanguage: 'en' }));
  migrateToProfiles(root, null);
  expect(fs.readdirSync(path.join(profileDir(root, 'acc'), 'images'))).toEqual(['keep.png']);
  expect(fs.existsSync(at('images', 'i1.png'))).toBe(true);
  expect(readJson(path.join(profileDir(root, 'acc'), 'profile.json'))).toEqual({ homeWidgets: [] });
});

it('a second run is a no-op', () => {
  oldLibrary('acc');
  migrateToProfiles(root, null);
  const before = fs.readdirSync(root).sort();
  expect(migrateToProfiles(root, 'x')).toBeNull();
  expect(fs.readdirSync(root).sort()).toEqual(before);
});

it('a fresh install needs nothing', () => {
  expect(needsMigration(root)).toBe(false);
  expect(migrateToProfiles(root, 'me')).toBeNull();
});

it('resumes with the owner chosen the first time, even after the database moved', () => {
  oldLibrary('acc');
  fs.writeFileSync(at('settings.json'), JSON.stringify({ theme: 'dark' }));
  fs.writeFileSync(at('migrating-to'), 'acc');
  fs.mkdirSync(profileDir(root, 'acc'), { recursive: true });
  fs.renameSync(at('voice-notes.sqlite'), path.join(profileDir(root, 'acc'), 'voice-notes.sqlite'));
  expect(migrateToProfiles(root, 'someone-else')).toBe('acc');
  expect(fs.existsSync(path.join(profileDir(root, 'acc'), 'recordings', 'n1.webm'))).toBe(true);
  expect(fs.existsSync(at('migrating-to'))).toBe(false);
});
