import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NoteStore } from '../../src/main/store/note-store';
import { RemindersService, type RemindersDeps } from '../../src/main/reminders/service';
import { Offline } from '../../src/main/sync/http-server';

const NOW = new Date(2026, 9, 30, 17, 30).getTime();
let root: string;
let store: NoteStore;
let quick: string[];
let d: RemindersDeps;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-remsvc-'));
  store = NoteStore.open(root, () => NOW);
  quick = [];
  d = {
    store: store.reminders,
    now: () => NOW,
    remind: vi.fn(async () => ({ action: 'none' as const })),
    toQuickNotes: (t) => void quick.push(t),
    google: { connected: () => false, create: vi.fn(async () => 'ev1'), remove: vi.fn(async () => {}), move: vi.fn(async () => {}) },
    changed: vi.fn(),
  };
});
afterEach(() => store.close());

const svc = () => new RemindersService(d);

it('stores a reminder read locally without asking the server', async () => {
  const r = await svc().add('remind me to call mom in 10 min');
  expect(r).toMatchObject({ ok: true, message: 'Reminder · call mom · 5:40 PM' });
  expect(store.reminders.list()).toMatchObject([{ text: 'call mom', dueAt: NOW + 600_000 }]);
  expect(d.remind).not.toHaveBeenCalled();
  expect(d.changed).toHaveBeenCalled();
});

it('asks the server when it cannot read the time, with now and tz', async () => {
  d.remind = vi.fn(async () => ({ action: 'remind' as const, text: 'call mom', dueAt: new Date(NOW + 3_600_000).toISOString() }));
  const r = await svc().add('remind me after lunch to call mom');
  expect(r?.ok).toBe(true);
  expect(store.reminders.list()[0]).toMatchObject({ text: 'call mom', dueAt: NOW + 3_600_000 });
  const req = (d.remind as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(req.text).toBe('remind me after lunch to call mom');
  expect(Date.parse(req.now)).toBe(NOW);
  expect(req.tz).toBeTruthy();
});

it('puts the command in Quick notes when no time is found or the server fails', async () => {
  expect(await svc().add('remind me to water plants')).toEqual({ ok: true, message: 'No time heard → Quick notes' });
  d.remind = vi.fn(async () => {
    throw new Offline();
  });
  await svc().add('remind me after lunch to eat');
  expect(quick).toEqual(['remind me to water plants', 'remind me after lunch to eat']);
  expect(store.reminders.list()).toEqual([]);
});

it('a voice reminder is not a reminder command → null', async () => {
  expect(await svc().add('call mom')).toBeNull();
});

it('adds a Google event with a popup at the time while connected', async () => {
  d.google.connected = () => true;
  await svc().add('remind me to call mom in 10 min');
  expect(d.google.create).toHaveBeenCalledWith('call mom', NOW + 600_000);
  expect(store.reminders.list()[0].googleEventId).toBe('ev1');
});

it('keeps the reminder on this PC when Google fails', async () => {
  d.google.connected = () => true;
  d.google.create = vi.fn(async () => {
    throw new Error('500');
  });
  const r = await svc().add('remind me to call mom in 10 min');
  expect(r).toMatchObject({ ok: true, message: 'Reminder · call mom · 5:40 PM (this PC only)' });
  expect(store.reminders.list()).toHaveLength(1);
});

it('snooze, done, cancel and update keep Google in step', async () => {
  d.google.connected = () => true;
  const s = svc();
  const r = (await s.add('remind me to call mom in 10 min'))!;
  const id = (r as { reminder: { id: string } }).reminder.id;
  await s.snooze(id);
  expect(store.reminders.get(id)?.dueAt).toBe(NOW + 600_000);
  expect(d.google.move).toHaveBeenCalledWith('ev1', NOW + 600_000, NOW + 600_000 + 900_000);
  await s.update(id, { text: 'call dad', dueAt: NOW + 5000 });
  expect(store.reminders.get(id)).toMatchObject({ text: 'call dad', dueAt: NOW + 5000 });
  await s.done(id);
  expect(store.reminders.get(id)?.status).toBe('done');
  await s.cancel(id);
  expect(store.reminders.get(id)?.status).toBe('cancelled');
  expect(d.google.remove).toHaveBeenCalledWith('ev1');
});

it('a reminder later than tomorrow shows its day', async () => {
  const r = await svc().add('remind me on Friday at 3 pm to pay rent');
  expect(r?.message).toBe('Reminder · pay rent · Fri 6 Nov, 3:00 PM');
});
