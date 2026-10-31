import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NoteStore } from '../../src/main/store/note-store';
import { MIGRATIONS } from '../../src/main/store/migrations';

const DAY = 86_400_000;
let root: string;
let clock: number;
let store: NoteStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-reminders-'));
  clock = 100 * DAY;
  store = NoteStore.open(root, () => clock);
});
afterEach(() => store.close());

it('is migration #11', () => {
  expect(MIGRATIONS).toHaveLength(11);
});

it('lists pending soonest first, then recent others latest first', () => {
  const r = store.reminders;
  const late = r.add('late', clock + 2000);
  const soon = r.add('soon', clock + 1000);
  const done = r.add('done', clock - 1000);
  r.setStatus(done.id, 'done');
  const old = r.add('old', clock - 8 * DAY);
  r.setStatus(old.id, 'cancelled');
  expect(r.list().map((x) => x.text)).toEqual(['soon', 'late', 'done']);
  expect(soon).toMatchObject({ status: 'pending', firedAt: null, googleEventId: null, createdAt: clock });
  expect(late.id).not.toBe(soon.id);
});

it('due skips fired and future reminders; snooze and update re-arm', () => {
  const r = store.reminders;
  const a = r.add('a', clock - 1);
  r.add('b', clock + 1000);
  expect(r.due(clock).map((x) => x.id)).toEqual([a.id]);
  r.markFired(a.id, clock);
  expect(r.due(clock)).toEqual([]);
  r.snooze(a.id, clock + 600_000);
  expect(r.get(a.id)).toMatchObject({ dueAt: clock + 600_000, firedAt: null });
  r.markFired(a.id, clock);
  r.update(a.id, { text: 'a2', dueAt: clock - 5 });
  expect(r.due(clock).map((x) => x.text)).toEqual(['a2']);
  r.setStatus(a.id, 'done');
  expect(r.due(clock)).toEqual([]);
});

it('keeps the Google event id', () => {
  const a = store.reminders.add('a', clock + 1);
  store.reminders.setGoogleEventId(a.id, 'ev1');
  expect(store.reminders.get(a.id)?.googleEventId).toBe('ev1');
});

it('prunes finished reminders older than 30 days, never pending ones', () => {
  const r = store.reminders;
  const pend = r.add('pending', clock - 60 * DAY);
  const gone = r.add('gone', clock - 31 * DAY);
  r.setStatus(gone.id, 'done');
  const kept = r.add('kept', clock - 29 * DAY);
  r.setStatus(kept.id, 'done');
  r.prune(clock);
  expect(r.get(pend.id)).toBeTruthy();
  expect(r.get(gone.id)).toBeNull();
  expect(r.get(kept.id)).toBeTruthy();
});
