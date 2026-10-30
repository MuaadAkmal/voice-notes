import { expect, it } from 'vitest';
import { isReminder, parseReminder } from '../../src/shared/reminder-command';

// Friday 30 Oct 2026, 17:30 local.
const now = new Date(2026, 9, 30, 17, 30).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const p = (s: string) => parseReminder(s, now);

it('knows a reminder command', () => {
  expect(isReminder('remind me to call mom in 10 min')).toBe(true);
  expect(isReminder('Remind me, about the dentist')).toBe(true);
  expect(isReminder('call mom later')).toBe(false);
  expect(isReminder('reminders are great')).toBe(false);
});

it('reads relative times', () => {
  expect(p('remind me to call mom in 10 min')).toEqual({ text: 'call mom', dueAt: now + 600_000 });
  expect(p('remind me in half an hour to stretch')).toEqual({ text: 'stretch', dueAt: now + 1_800_000 });
  expect(p('Remind me to call mom in 10 minutes.')).toEqual({ text: 'call mom', dueAt: now + 600_000 });
  expect(p('remind me to check the oven in an hour')).toEqual({ text: 'check the oven', dueAt: now + 3_600_000 });
  expect(p('remind me in 2 hours to leave')?.dueAt).toBe(now + 7_200_000);
});

it('reads clock times, rolling past ones to the next occurrence', () => {
  expect(p('remind me to call mom at 5')).toEqual({ text: 'call mom', dueAt: at(31, 5) });
  expect(p('remind me to call mom at 6 pm')).toEqual({ text: 'call mom', dueAt: at(30, 18) });
  expect(p('remind me at 18:15 to eat')).toEqual({ text: 'eat', dueAt: at(30, 18, 15) });
  expect(p('remind me at 5 pm to go')?.dueAt).toBe(at(31, 17));
  expect(p('remind me to read at 9:30 p.m.')).toEqual({ text: 'read', dueAt: at(30, 21, 30) });
});

it('reads days', () => {
  expect(p('remind me tomorrow at 7 pm to call Alex')).toEqual({ text: 'call Alex', dueAt: at(31, 19) });
  expect(p('remind me tonight at 9 to lock up')).toEqual({ text: 'lock up', dueAt: at(30, 21) });
  expect(p('remind me on Friday at 3 pm to pay rent')).toEqual({ text: 'pay rent', dueAt: new Date(2026, 10, 6, 15).getTime() });
  expect(p('remind me tomorrow morning to run')).toEqual({ text: 'run', dueAt: at(31, 9) });
});

it('gives no time when none is said, and null when it is not a reminder', () => {
  expect(p('remind me to water plants')).toEqual({ text: 'water plants', dueAt: null });
  expect(p('remind me')).toBeNull();
  expect(p('call mom later')).toBeNull();
});
