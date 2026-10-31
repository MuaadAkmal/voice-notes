import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/main/store/migrations';
import { NoteStore } from '../../src/main/store/note-store';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-m9-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const NOTE = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Old', file_path: 'recordings/x.webm', duration_ms: 1500, size_bytes: 3,
  mime_type: 'audio/webm', status: 'missing', created_at: 5, updated_at: 6, synced_at: 7, folder_id: 'f1', source: 'both',
  kind: 'rewind', window_title: 'YouTube', show: 'Show', starred: 1, transcript: 'hi', transcript_lang: 'en', transcribed_at: 8,
  deleted_at: 9, version: 4,
};

it('migration 9 keeps every note column and index and allows remote', () => {
  const file = path.join(root, 'voice-notes.sqlite');
  const db = new Database(file);
  MIGRATIONS.slice(0, 8).forEach((sql) => db.exec(sql));
  db.pragma('user_version = 8');
  db.prepare("INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES ('f1', 'F', NULL, 1, 1)").run();
  const cols = Object.keys(NOTE);
  db.prepare(`INSERT INTO notes (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(NOTE);
  db.close();

  NoteStore.open(root).close();

  const after = new Database(file);
  try {
    expect(after.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(after.prepare('SELECT * FROM notes').get()).toEqual(NOTE);
    after.prepare("UPDATE notes SET status = 'remote'").run();
    expect(() => after.prepare("UPDATE notes SET status = 'bogus'").run()).toThrow();
    const indexes = (after.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notes'").all() as { name: string }[]).map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['notes_created_at', 'notes_folder', 'notes_show']));
    expect(after.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'file_outbox'").get()).toBeDefined();
  } finally {
    after.close();
  }
});
