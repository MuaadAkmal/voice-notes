import { expect, it } from 'vitest';
import { QuotaWatch } from '../../src/main/transcription/quota-watch';

const NOV = '2026-12-01T00:00:00.000Z';
const DEC = '2027-01-01T00:00:00.000Z';

function setup(now = Date.parse('2026-11-20T00:00:00Z')) {
  let settings = { cloudWarnedPeriod: null as string | null, cloudOutPeriod: null as string | null };
  let t = now;
  const watch = new QuotaWatch({
    getSettings: () => settings,
    save: (p) => (settings = { ...settings, ...p }),
    now: () => t,
  });
  return { watch, settings: () => settings, setNow: (n: number) => (t = n) };
}

it('says nothing while under 80%', () => {
  const { watch } = setup();
  expect(watch.observe({ used: 100, limit: 1800, resetsAt: NOV })).toBeNull();
  expect(watch.paused()).toBe(false);
});

it('warns once per month at 80%', () => {
  const { watch, settings } = setup();
  expect(watch.observe({ used: 1500, limit: 1800, resetsAt: NOV })).toBe('low');
  expect(settings().cloudWarnedPeriod).toBe(NOV);
  expect(watch.observe({ used: 1600, limit: 1800, resetsAt: NOV })).toBeNull();
  expect(watch.observe({ used: 1500, limit: 1800, resetsAt: DEC })).toBe('low');
});

it('the warning shown on another run of the app is not shown again', () => {
  const { watch, settings } = setup();
  settings().cloudWarnedPeriod = NOV;
  expect(watch.observe({ used: 1500, limit: 1800, resetsAt: NOV })).toBeNull();
});

it('at the limit says so once and pauses until the month resets', () => {
  const { watch, settings, setNow } = setup();
  expect(watch.observe({ used: 1800, limit: 1800, resetsAt: NOV })).toBe('out');
  expect(settings().cloudOutPeriod).toBe(NOV);
  expect(watch.paused()).toBe(true);
  expect(watch.observe({ used: 1800, limit: 1800, resetsAt: NOV })).toBeNull();
  setNow(Date.parse(NOV));
  expect(watch.paused()).toBe(false);
});

it('a refused transcription counts as out, once', () => {
  const { watch } = setup();
  expect(watch.exceeded(NOV)).toBe('out');
  expect(watch.paused()).toBe(true);
  expect(watch.exceeded(NOV)).toBeNull();
});

it('a refusal without a reset date says so but does not pause', () => {
  const { watch } = setup();
  expect(watch.exceeded('')).toBe('out');
  expect(watch.paused()).toBe(false);
});

it('a quiet look at the usage pauses without a notice', () => {
  const { watch, settings } = setup();
  watch.observe({ used: 1800, limit: 1800, resetsAt: NOV }, { quiet: true });
  expect(watch.paused()).toBe(true);
  expect(settings().cloudOutPeriod).toBeNull();
});

it('an upgrade (a higher limit) lifts the pause', () => {
  const { watch } = setup();
  watch.observe({ used: 1800, limit: 1800, resetsAt: NOV });
  watch.observe({ used: 1810, limit: 18000, resetsAt: NOV });
  expect(watch.paused()).toBe(false);
});
