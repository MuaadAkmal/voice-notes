import { describe, expect, it } from 'vitest';
import { planName, usageText } from '../../src/shared/cloud-usage';

describe('usageText', () => {
  const resetsAt = new Date(2026, 10, 1, 12).toISOString();

  it('floors minutes and shows the local reset day', () => {
    expect(usageText({ used: 2339, limit: 7200, resetsAt })).toBe('38 / 120 min this month · resets 1 Nov');
    expect(usageText({ used: 600, limit: 1800, resetsAt })).toBe('10 / 30 min this month · resets 1 Nov');
  });

  it('paid plans read in hours, used rounded down', () => {
    expect(usageText({ used: 5399, limit: 18000, resetsAt })).toBe('1.4 / 5 h this month · resets 1 Nov');
    expect(usageText({ used: 0, limit: 36000, resetsAt })).toBe('0 / 10 h this month · resets 1 Nov');
  });
});

describe('planName', () => {
  it('names the plans, and passes an unknown one through', () => {
    expect(['free', 'standard', 'pro', 'team'].map(planName)).toEqual(['Free', 'Standard', 'Pro', 'team']);
  });
});
