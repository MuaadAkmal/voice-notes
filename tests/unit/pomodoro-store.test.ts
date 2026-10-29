import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NoteStore } from '../../src/main/store/note-store';

let clock: number;
let store: NoteStore;

beforeEach(() => {
  clock = 1;
  store = NoteStore.open(fs.mkdtempSync(path.join(os.tmpdir(), 'vn-pomodoro-')), () => clock);
});
afterEach(() => store.close());

it('records finished sessions oldest first, and clears them', () => {
  store.pomodoro.add(25 * 60_000);
  clock = 2;
  store.pomodoro.add(50 * 60_000);
  expect(store.pomodoro.list()).toEqual([
    { completedAt: 1, focusMs: 25 * 60_000 },
    { completedAt: 2, focusMs: 50 * 60_000 },
  ]);
  store.pomodoro.clear();
  expect(store.pomodoro.list()).toEqual([]);
});
