import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NoteStore } from '../../src/main/store/note-store';
import { ReminderScheduler } from '../../src/main/reminders/scheduler';

let root: string;
let clock: number;
let store: NoteStore;
let fired: { text: string; missed: boolean }[];
let tick: (() => void) | null;

const make = () =>
  new ReminderScheduler({
    store: store.reminders,
    now: () => clock,
    setInterval: (fn, ms) => {
      expect(ms).toBe(30_000);
      tick = fn;
      return 1;
    },
    clearInterval: () => (tick = null),
    fire: (r, missed) => fired.push({ text: r.text, missed }),
  });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-sched-'));
  clock = 1_000_000_000;
  store = NoteStore.open(root, () => clock);
  fired = [];
  tick = null;
});
afterEach(() => store.close());

it('fires a due reminder once and marks it', () => {
  store.reminders.add('a', clock);
  const s = make();
  s.start();
  expect(fired).toEqual([{ text: 'a', missed: false }]);
  s.check();
  expect(fired).toHaveLength(1);
  expect(store.reminders.list()[0].firedAt).toBe(clock);
});

it('fires a future reminder when the clock passes it', () => {
  store.reminders.add('later', clock + 60_000);
  make().start();
  expect(fired).toEqual([]);
  clock += 60_000;
  tick!();
  expect(fired).toEqual([{ text: 'later', missed: false }]);
});

it('calls a reminder missed only at start, more than 2 minutes late', () => {
  store.reminders.add('old', clock - 10 * 60_000);
  store.reminders.add('recent', clock - 60_000);
  const s = make();
  s.start();
  expect(fired).toEqual([
    { text: 'old', missed: true },
    { text: 'recent', missed: false },
  ]);
  store.reminders.add('slept', clock + 1000);
  clock += 30 * 60_000; // asleep, then resume
  s.check();
  expect(fired[2]).toEqual({ text: 'slept', missed: false });
  expect(fired).toHaveLength(3);
});

it('does not fire again after a restart', () => {
  store.reminders.add('a', clock);
  make().start();
  const again = make();
  again.start();
  expect(fired).toHaveLength(1);
  again.stop();
  expect(tick).toBeNull();
});
