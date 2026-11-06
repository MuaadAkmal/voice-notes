import { describe, expect, it } from 'vitest';
import { planName, polishedCostText, quotaState, storageText, usageText } from '../../src/shared/cloud-usage';

describe('storageText', () => {
  const MB = 1024 * 1024;
  it('reads in MB on the Free plan, GB on the bigger ones', () => {
    expect(storageText({ used: 180 * MB, limit: 250 * MB })).toBe('180 MB of 250 MB');
    expect(storageText({ used: 0, limit: 250 * MB })).toBe('0 MB of 250 MB');
    expect(storageText({ used: 1229 * MB, limit: 5 * 1024 * MB })).toBe('1.2 GB of 5 GB');
    expect(storageText({ used: 20 * 1024 * MB, limit: 20 * 1024 * MB })).toBe('20 GB of 20 GB');
  });
});

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

describe('quotaState', () => {
  it('is low from 80% and out at the limit', () => {
    expect(quotaState({ used: 1439, limit: 1800 })).toBe('ok');
    expect(quotaState({ used: 1440, limit: 1800 })).toBe('low');
    expect(quotaState({ used: 1800, limit: 1800 })).toBe('out');
    expect(quotaState({ used: 1900, limit: 1800 })).toBe('out');
  });

  it('is ok when the numbers make no sense', () => {
    expect(quotaState({ used: 5, limit: 0 })).toBe('ok');
    expect(quotaState({ used: Number.NaN, limit: 1800 })).toBe('ok');
    expect(quotaState({ used: 5, limit: Number.POSITIVE_INFINITY })).toBe('ok');
  });
});

describe('polishedCostText', () => {
  it('rounds the estimate up to whole minutes, at least one', () => {
    expect(polishedCostText(1)).toBe('Uses about 1 min of Cloud minutes');
    expect(polishedCostText(720)).toBe('Uses about 1 min of Cloud minutes'); // 60 s exactly
    expect(polishedCostText(721)).toBe('Uses about 2 min of Cloud minutes');
    expect(polishedCostText(2400)).toBe('Uses about 4 min of Cloud minutes');
  });
  it('reads at most 5000 characters', () => {
    expect(polishedCostText(50_000)).toBe('Uses about 7 min of Cloud minutes'); // ceil(5000 / 12) = 417 s
  });
});
