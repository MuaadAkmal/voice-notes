import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { runPowerShell, type Spawn } from '../../../src/main/commands/powershell';

type FakeChild = EventEmitter & { stdout: PassThrough; kill: ReturnType<typeof vi.fn<() => void>> };

function fakeSpawn(act: (child: FakeChild) => void) {
  const calls: { exe: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const spawn: Spawn = (exe, args, opts) => {
    calls.push({ exe, args, env: opts.env });
    const child: FakeChild = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn<() => void>() });
    setTimeout(() => act(child), 0);
    return child;
  };
  return { spawn, calls };
}

const finish = (out: string, code = 0) => (c: FakeChild) => {
  c.stdout.end(out);
  c.stdout.on('end', () => c.emit('close', code));
  c.stdout.resume();
};

it('parses the last JSON line and passes values only through env', async () => {
  const { spawn, calls } = fakeSpawn(finish('noise\r\n{"url":"x"}\r\n'));
  expect(await runPowerShell('Write-Output 1', { VN_HWND: '7' }, spawn)).toEqual({ url: 'x' });
  const { exe, args, env } = calls[0];
  expect(exe).toBe('powershell.exe');
  expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
  const script = Buffer.from(args[5], 'base64').toString('utf16le');
  expect(script).toContain('Write-Output 1');
  expect(script).toContain('UTF8'); // non-ASCII titles and paths survive
  expect(env.VN_HWND).toBe('7');
});

it('gives null for bad output or a failed exit', async () => {
  expect(await runPowerShell('x', {}, fakeSpawn(finish('not json')).spawn)).toBeNull();
  expect(await runPowerShell('x', {}, fakeSpawn(finish('{"url":"x"}', 1)).spawn)).toBeNull();
  expect(await runPowerShell('x', {}, fakeSpawn((c) => c.emit('error', new Error('ENOENT'))).spawn)).toBeNull();
});

it('kills a script that runs past the timeout', async () => {
  let child: FakeChild | undefined;
  const { spawn } = fakeSpawn((c) => (child = c));
  expect(await runPowerShell('x', {}, spawn, 50)).toBeNull();
  expect(child!.kill).toHaveBeenCalled();
});
