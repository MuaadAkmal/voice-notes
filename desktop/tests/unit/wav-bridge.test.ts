import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WavBridge } from '../../src/main/transcription/wav-bridge';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('resolves with the bytes the dashboard sends back', async () => {
  const bridge = new WavBridge();
  const ids: number[] = [];
  const p1 = bridge.request((id) => (ids.push(id), true));
  const p2 = bridge.request((id) => (ids.push(id), true));
  expect(ids[1]).toBeGreaterThan(ids[0]);
  bridge.settle(ids[0], { bytes: new Uint8Array([1]) });
  bridge.settle(ids[1], { error: "Couldn't read the audio" });
  await expect(p1).resolves.toEqual(new Uint8Array([1]));
  await expect(p2).rejects.toThrow("Couldn't read the audio");
});

it('rejects at once without a dashboard', async () => {
  const bridge = new WavBridge();
  await expect(bridge.request(() => false)).rejects.toThrow(
    'Open the dashboard to transcribe',
  );
});

it('times out after 60 s and ignores late or unknown replies', async () => {
  const bridge = new WavBridge();
  let id = 0;
  const p = bridge.request((i) => ((id = i), true));
  const settled = expect(p).rejects.toThrow('Open the dashboard to transcribe');
  vi.advanceTimersByTime(60_000);
  await settled;
  expect(() => bridge.settle(id, { bytes: new Uint8Array() })).not.toThrow();
  expect(() => bridge.settle(999, { bytes: new Uint8Array() })).not.toThrow();
});
