import { describe, expect, it } from 'vitest';
import { cleanIpcError, dayGroupLabel, defaultTitle, formatBytes, formatDuration, isDefaultTitle } from '../../src/shared/format';

describe('formatBytes', () => {
  it('uses MB below a GB and GB above, like the model sizes read', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(8_928_640)).toBe('9 MB');
    expect(formatBytes(147_951_465)).toBe('148 MB');
    expect(formatBytes(1_533_763_059)).toBe('1.5 GB');
    expect(formatBytes(1_624_555_275)).toBe('1.6 GB');
  });
});

describe('formatDuration', () => {
  it('shows a dash for unknown duration', () => expect(formatDuration(0)).toBe('—'));
  it('formats seconds', () => expect(formatDuration(4_200)).toBe('0:04'));
  it('formats minutes', () => expect(formatDuration(65_000)).toBe('1:05'));
  it('rounds sub-second clips up to 0:01', () => expect(formatDuration(800)).toBe('0:01'));
  it('rounds to the nearest second', () => expect(formatDuration(4_600)).toBe('0:05'));
});

describe('defaultTitle', () => {
  it('uses zero-padded 24h local time', () => {
    expect(defaultTitle(new Date(2026, 9, 24, 9, 5))).toBe('Voice note · 09:05');
  });
});

describe('dayGroupLabel', () => {
  const now = new Date(2026, 9, 24, 15).getTime();
  it('labels today', () => expect(dayGroupLabel(new Date(2026, 9, 24, 1).getTime(), now)).toBe('Today'));
  it('labels yesterday', () => expect(dayGroupLabel(new Date(2026, 9, 23, 23).getTime(), now)).toBe('Yesterday'));
  it('labels older dates', () =>
    expect(dayGroupLabel(new Date(2026, 9, 20).getTime(), now)).toBe('Tue, 20 Oct 2026'));
});

describe('cleanIpcError', () => {
  it('strips the electron invoke prefix', () => {
    const e = new Error(
      "Error invoking remote method 'folders:create': Error: A folder named \"x\" already exists here",
    );
    expect(cleanIpcError(e)).toBe('A folder named "x" already exists here');
  });
  it('handles plain values', () => expect(cleanIpcError('boom')).toBe('boom'));
});

describe('isDefaultTitle', () => {
  it('recognises only the untouched default title', () => {
    expect(isDefaultTitle(defaultTitle(new Date(2026, 9, 24, 9, 5)))).toBe(true);
    expect(isDefaultTitle('Voice note · 09:05 gracias')).toBe(false);
    expect(isDefaultTitle('gracias')).toBe(false);
  });
});
