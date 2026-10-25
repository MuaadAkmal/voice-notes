import { beforeEach, expect, it } from 'vitest';
import { AutoPause } from '../../src/main/media/auto-pause';

let presses: number;
let enabled: boolean;
let resolveProbe: (playing: boolean) => void;
let probes: number;
let ap: AutoPause;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  presses = 0;
  probes = 0;
  enabled = true;
  ap = new AutoPause({
    enabled: () => enabled,
    probe: () => {
      probes++;
      return new Promise<boolean>((r) => (resolveProbe = r));
    },
    press: () => presses++,
  });
});

it('pauses playing media for a mic note and resumes at the end', async () => {
  ap.start('mic');
  resolveProbe(true);
  await flush();
  expect(presses).toBe(1);
  ap.end();
  expect(presses).toBe(2);
});

it('does nothing when nothing is playing (so it never starts music)', async () => {
  ap.start('mic');
  resolveProbe(false);
  await flush();
  ap.end();
  expect(presses).toBe(0);
});

it('never probes or pauses for system or both: the clip would be silent', () => {
  ap.start('system');
  ap.start('both');
  ap.end();
  expect(probes).toBe(0);
  expect(presses).toBe(0);
});

it('respects the setting', () => {
  enabled = false;
  ap.start('mic');
  expect(probes).toBe(0);
});

it('a capture that ended before the probe answered never pauses', async () => {
  ap.start('mic');
  const late = resolveProbe;
  ap.end();
  late(true);
  await flush();
  expect(presses).toBe(0);
});

it('a probe from an earlier capture cannot pause a later one', async () => {
  ap.start('mic');
  const first = resolveProbe;
  ap.end();
  ap.start('mic');
  first(true);
  await flush();
  expect(presses).toBe(0);
  resolveProbe(true);
  await flush();
  expect(presses).toBe(1);
});

it('a failed probe counts as not playing', async () => {
  ap = new AutoPause({ enabled: () => true, probe: () => Promise.reject(new Error('x')), press: () => presses++ });
  ap.start('mic');
  await flush();
  ap.end();
  expect(presses).toBe(0);
});
