import { expect, it } from 'vitest';
import { applyCloudDefault } from '../../../src/main/transcription/cloud-default';
import { DEFAULT_SETTINGS } from '../../../src/main/settings';
import type { Settings } from '../../../src/shared/ipc';

const withProvider = (provider: Settings['transcription']['provider']): Settings => ({
  ...DEFAULT_SETTINGS,
  transcription: { ...DEFAULT_SETTINGS.transcription, provider, baseUrl: 'http://x/v1' },
});

it('null + signed in → cloud, keeping the rest of transcription', () => {
  expect(applyCloudDefault(withProvider(null), true)).toEqual({
    transcription: { ...DEFAULT_SETTINGS.transcription, provider: 'cloud', baseUrl: 'http://x/v1' },
  });
});

it('never overwrites a chosen provider', () => {
  for (const p of ['server', 'local', 'cloud'] as const) expect(applyCloudDefault(withProvider(p), true)).toBeNull();
});

it('signed out → nothing', () => {
  expect(applyCloudDefault(withProvider(null), false)).toBeNull();
});

it('signed out keeps cloud', () => {
  expect(applyCloudDefault(withProvider('cloud'), false)).toBeNull();
});
