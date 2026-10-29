import { expect, it } from 'vitest';
import { parseCalendarCommand } from '../../src/shared/calendar-command';

const q = (s: string) => parseCalendarCommand(s)?.text ?? null;

it('strips the trigger and Whisper punctuation', () => {
  expect(q('Calendar, meeting with Alex tomorrow 5 pm')).toBe('meeting with Alex tomorrow 5 pm');
  expect(q('Calendar. Lunch tomorrow 1pm.')).toBe('Lunch tomorrow 1pm');
  expect(q(' calender: dentist Friday at 9')).toBe('dentist Friday at 9');
  expect(q('CALENDAR lunch')).toBe('lunch');
});

it('accepts add event / add to calendar', () => {
  expect(q('Add event, gym at 7')).toBe('gym at 7');
  expect(q('add an event standup 10am')).toBe('standup 10am');
  expect(q('Add to my calendar: flight Monday 6am')).toBe('flight Monday 6am');
});

it('strips lead-in verbs', () => {
  expect(q('Calendar, set up meeting with alex tomorrow 5 pm')).toBe('meeting with alex tomorrow 5 pm');
  expect(q('Calendar set up a meeting with alex at 5')).toBe('meeting with alex at 5');
  expect(q('Calendar, remind me to call mum at 4')).toBe('call mum at 4');
  expect(q('calendar schedule a call with Sam friday')).toBe('call with Sam friday');
});

it('leaves ordinary dictation alone', () => {
  expect(q('Schedule is tight this week')).toBeNull();
  expect(q('Remind me to call mum')).toBeNull();
  expect(q('The calendar is full')).toBeNull();
  expect(q('Calendars are hard')).toBeNull();
  expect(q('Calendar.')).toBeNull();
  expect(q('')).toBeNull();
});
