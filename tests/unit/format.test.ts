import { describe, expect, it } from 'vitest';
import { dayGroupLabel, defaultTitle, formatDuration } from '../../src/shared/format';

describe('formatDuration', () => {
  it('shows a dash for unknown duration', () => expect(formatDuration(0)).toBe('—'));
  it('formats seconds', () => expect(formatDuration(4_200)).toBe('0:04'));
  it('formats minutes', () => expect(formatDuration(65_000)).toBe('1:05'));
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
