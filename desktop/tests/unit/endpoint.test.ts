import { expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/main/settings';
import { resolveEndpoint } from '../../src/main/transcription/endpoint';
import type { Settings } from '../../src/shared/channels';

const withTranscription = (t: Partial<Settings['transcription']>): Settings => ({
  ...DEFAULT_SETTINGS,
  transcription: { ...DEFAULT_SETTINGS.transcription, ...t },
});

const fakeLocal = () => ({ ensure: vi.fn(async () => 'http://127.0.0.1:1/v1'), release: vi.fn() });

it("uses the user's server with its key", async () => {
  const local = fakeLocal();
  const ep = await resolveEndpoint({
    settings: () => withTranscription({ provider: 'server', baseUrl: 'https://vm/v1', model: 'whisper' }),
    secrets: { get: () => 'k' },
    local,
  });
  expect(ep).toMatchObject({ baseUrl: 'https://vm/v1', model: 'whisper', apiKey: 'k', local: false });
  ep.release();
  expect(local.ensure).not.toHaveBeenCalled();
  expect(local.release).not.toHaveBeenCalled();
});

it('uses the built-in engine without a key, and releases it once', async () => {
  const local = fakeLocal();
  const ep = await resolveEndpoint({
    settings: () => withTranscription({ provider: 'local', localModel: 'base' }),
    secrets: { get: () => 'k' },
    local,
  });
  expect(local.ensure).toHaveBeenCalledWith('base');
  expect(ep).toMatchObject({ baseUrl: 'http://127.0.0.1:1/v1', model: 'base', apiKey: null, local: true });
  ep.release();
  ep.release();
  expect(local.release).toHaveBeenCalledTimes(1);
});

it('refuses when nothing is set up', async () => {
  await expect(
    resolveEndpoint({ settings: () => DEFAULT_SETTINGS, secrets: { get: () => null }, local: fakeLocal() }),
  ).rejects.toThrow('Set up transcription first');
});

it('uses the cloud without a server URL or key', async () => {
  const local = fakeLocal();
  const ep = await resolveEndpoint({
    settings: () => withTranscription({ provider: 'cloud', baseUrl: '' }),
    secrets: { get: () => null },
    local,
  });
  expect(ep).toMatchObject({ cloud: true, local: false });
  expect(local.ensure).not.toHaveBeenCalled();
});
