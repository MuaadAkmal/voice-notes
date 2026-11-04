import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/main/store/migrations';
import { NoteStore } from '../../src/main/store/note-store';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-m12-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('migration 12 adds page_id and pulls everything once more, so voice blocks pulled before it get their page', () => {
  const file = path.join(root, 'voice-notes.sqlite');
  const db = new Database(file);
  MIGRATIONS.slice(0, 11).forEach((sql) => db.exec(sql));
  db.pragma('user_version = 11');
  db.prepare("INSERT INTO sync_state (key, value) VALUES ('cursor', '42')").run();
  db.close();

  const store = NoteStore.open(root);
  try {
    expect(store.sync.state.cursor()).toBe(0);
  } finally {
    store.close();
  }
  const after = new Database(file);
  try {
    const cols = (after.prepare('PRAGMA table_info(notes)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('page_id');
  } finally {
    after.close();
  }
});
