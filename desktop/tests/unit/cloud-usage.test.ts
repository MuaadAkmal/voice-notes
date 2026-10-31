import { describe, expect, it } from 'vitest';
import { usageText } from '../../src/shared/cloud-usage';

describe('usageText', () => {
  it('floors minutes and shows the local reset day', () => {
    const resetsAt = new Date(2026, 10, 1, 12).toISOString();
    expect(usageText({ used: 2339, limit: 7200, resetsAt })).toBe('38 / 120 min this month · resets 1 Nov');
  });
});
