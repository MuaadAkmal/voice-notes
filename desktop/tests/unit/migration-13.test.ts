import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/main/store/migrations';
import { NoteStore } from '../../src/main/store/note-store';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-m13-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('migration 13 adds polished_at, null for notes already there', async () => {
  const file = path.join(root, 'voice-notes.sqlite');
  const db = new Database(file);
  MIGRATIONS.slice(0, 12).forEach((sql) => db.exec(sql));
  db.pragma('user_version = 12');
  db.close();

  const store = NoteStore.open(root);
  try {
    const note = await store.create({ bytes: Buffer.from('a'), durationMs: 1, mimeType: 'audio/webm', source: 'mic' });
    expect(store.get(note.id)!.polishedAt).toBeNull();
    expect(store.setPolished(note.id, 7).polishedAt).toBe(7);
  } finally {
    store.close();
  }
});
