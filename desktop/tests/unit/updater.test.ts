import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../src/shared/channels';
import { loginItem, updateExePath } from '../../src/main/updater/install';
import { UPDATE_FEED_URL, type UpdaterEvents, UpdateService } from '../../src/main/updater/service';

function setup(opts: { supported?: boolean; busy?: boolean } = {}) {
  let on: UpdaterEvents | null = null;
  const port = {
    setFeedURL: vi.fn(),
    check: vi.fn(),
    install: vi.fn(),
    listen: (events: UpdaterEvents) => void (on = events),
  };
  const changes: UpdateStatus[] = [];
  const ready: UpdateStatus[] = [];
  const service = new UpdateService({
    port,
    version: '3.3.0',
    supported: opts.supported ?? true,
    busy: () => opts.busy ?? false,
    onChange: (s) => changes.push(s),
    onReady: (s) => ready.push(s),
  });
  const emit = (event: keyof UpdaterEvents, arg?: unknown) => (on![event] as (a?: unknown) => void)(arg);
  return { service, port, emit, changes, ready };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

it('does nothing in a copy that cannot update itself', () => {
  const { service, port } = setup({ supported: false });
  expect(service.status).toEqual({ version: '3.3.0', state: 'unsupported' });
  service.start();
  service.check();
  vi.advanceTimersByTime(3 * 60 * 60_000);
  expect(port.setFeedURL).not.toHaveBeenCalled();
  expect(port.check).not.toHaveBeenCalled();
});

it('checks the feed a minute after start, then hourly', () => {
  const { service, port } = setup();
  expect(port.setFeedURL).toHaveBeenCalledWith(UPDATE_FEED_URL);
  service.start();
  expect(port.check).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(port.check).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60 * 60_000);
  expect(port.check).toHaveBeenCalledTimes(2);
  service.stop();
  vi.advanceTimersByTime(3 * 60 * 60_000);
  expect(port.check).toHaveBeenCalledTimes(2);
});

it('goes from checking through downloading to ready, and tells once', () => {
  const { service, emit, ready } = setup();
  emit('checking');
  expect(service.status.state).toBe('checking');
  emit('available');
  expect(service.status.state).toBe('downloading');
  emit('downloaded', '3.4.0');
  expect(service.status).toEqual({ version: '3.3.0', state: 'ready', newVersion: '3.4.0' });
  expect(ready).toHaveLength(1);
});

it('runs one check at a time and none after a download', () => {
  const { service, port, emit } = setup();
  emit('checking');
  service.check();
  emit('available');
  service.check();
  emit('downloaded', null);
  service.check();
  expect(port.check).not.toHaveBeenCalled();
});

it('a background check stays quiet, one the user asked for answers', () => {
  const { service, emit } = setup();
  service.check(false);
  emit('checking');
  emit('notAvailable');
  expect(service.status.state).toBe('idle');
  service.check(false);
  emit('error', new Error('offline'));
  expect(service.status.state).toBe('idle');

  service.check();
  emit('notAvailable');
  expect(service.status.state).toBe('up-to-date');
  service.check();
  emit('error', new Error('offline'));
  expect(service.status.state).toBe('error');
  expect(service.status.error).not.toContain('offline');
});

it('a check that throws is reported like a failed one', () => {
  const { service, port } = setup();
  port.check.mockImplementation(() => {
    throw new Error('Update.exe missing');
  });
  service.check(false);
  expect(service.status.state).toBe('idle');
  service.check();
  expect(service.status.state).toBe('error');
});

it('restarts only with an update ready and nothing recording', () => {
  const idle = setup();
  expect(idle.service.restart()).toBe('not-ready');
  idle.emit('downloaded', '3.4.0');
  expect(idle.service.restart()).toBe('restarting');
  expect(idle.port.install).toHaveBeenCalledTimes(1);

  const recording = setup({ busy: true });
  recording.emit('downloaded', '3.4.0');
  expect(recording.service.restart()).toBe('busy');
  expect(recording.port.install).not.toHaveBeenCalled();
});

const exe = 'C:\\Users\\me\\AppData\\Local\\voice_notes\\app-3.3.0\\Voice Notes.exe';

it('finds Update.exe above the versioned folder', () => {
  expect(updateExePath(exe)).toBe('C:\\Users\\me\\AppData\\Local\\voice_notes\\Update.exe');
});

it('an installed copy logs in through Update.exe, so an update cannot strand it', () => {
  expect(loginItem(exe, true, '--hidden')).toEqual({
    path: 'C:\\Users\\me\\AppData\\Local\\voice_notes\\Update.exe',
    args: ['--processStart', '"Voice Notes.exe"', '--process-start-args', '"--hidden"'],
  });
});

it('any other copy logs in as itself', () => {
  expect(loginItem(exe, false, '--hidden')).toEqual({ args: ['--hidden'] });
});
