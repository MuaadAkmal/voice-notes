import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { NoteStore } from '../../src/main/store/note-store';
import { MIGRATIONS } from '../../src/main/store/migrations';

let root: string;
let clock: number;
let store: NoteStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-dictations-'));
  clock = 1;
  store = NoteStore.open(root, () => clock);
});
afterEach(() => store.close());

it('adds and lists newest first', () => {
  store.dictations.add('a', 'Slack');
  clock = 2;
  store.dictations.add('b', null);
  const list = store.dictations.list();
  expect(list.map((d) => d.text)).toEqual(['b', 'a']);
  expect(list.map((d) => d.app)).toEqual([null, 'Slack']);
  expect(list[1].createdAt).toBe(1);
  expect(store.dictations.get(list[0].id)).toEqual(list[0]);
});

it('prunes only entries older than the window', () => {
  clock = 0;
  store.dictations.add('old', null);
  clock = 1000;
  store.dictations.add('new', null);
  clock = 1500;
  expect(store.dictations.pruneOlderThan(1000)).toBe(1);
  expect(store.dictations.list().map((d) => d.text)).toEqual(['new']);
});

it('clear empties the table', () => {
  store.dictations.add('a', null);
  store.dictations.clear();
  expect(store.dictations.list()).toEqual([]);
});

it('migrates an existing v6 database', () => {
  store.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-mig7-'));
  const raw = new Database(path.join(dir, 'voice-notes.sqlite'));
  for (const sql of MIGRATIONS.slice(0, 6)) raw.exec(sql);
  raw.pragma('user_version = 6');
  raw.close();
  store = NoteStore.open(dir, () => clock);
  const check = new Database(path.join(dir, 'voice-notes.sqlite'));
  expect(check.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
  check.close();
  expect(store.dictations.list()).toEqual([]);
});
