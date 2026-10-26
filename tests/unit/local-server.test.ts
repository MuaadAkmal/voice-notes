import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type ChildLike, EngineServer, type EngineServerDeps } from '../../src/main/local-whisper/server';

class FakeChild implements ChildLike {
  static next = 100;
  static slowKill = false; // TerminateProcess is asynchronous: the exit comes later
  pid = FakeChild.next++;
  killed = false;
  private exits: ((code: number | null) => void)[] = [];
  private errors: ((err: Error) => void)[] = [];
  kill(): void {
    this.killed = true;
    if (!FakeChild.slowKill) this.exit(null);
  }
  on(ev: 'exit' | 'error', cb: (arg: never) => void): void {
    if (ev === 'exit') this.exits.push(cb as (code: number | null) => void);
    else this.errors.push(cb as (err: Error) => void);
  }
  exit(code: number | null): void {
    for (const cb of this.exits.splice(0)) cb(code);
  }
  fail(err: Error): void {
    for (const cb of this.errors) cb(err);
  }
}

const READY = '<title>Whisper.cpp Server</title>';
let dir: string;
let pidFile: string;
let spawned: { exe: string; args: string[]; child: FakeChild }[];
let body: () => Promise<string>;
let killedPids: number[];
let whisperPids: Set<number>;

function make(over: Partial<EngineServerDeps> = {}) {
  return new EngineServer({
    spawn: (exe, args) => {
      const child = new FakeChild();
      spawned.push({ exe, args, child });
      return child;
    },
    freePort: async () => 4321,
    get: () => body(),
    cores: 4,
    pidFile,
    isWhisperPid: (pid) => whisperPids.has(pid),
    killPid: (pid) => killedPids.push(pid),
    ...over,
  });
}

const last = () => spawned[spawned.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-engine-'));
  pidFile = path.join(dir, 'server.pid');
  spawned = [];
  killedPids = [];
  whisperPids = new Set();
  let polls = 0;
  body = async () => {
    polls++;
    if (polls < 2) throw new Error('ECONNREFUSED');
    return READY;
  };
});
afterEach(() => {
  FakeChild.slowKill = false;
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

it('starts on first use with the pinned arguments', async () => {
  const s = make();
  const url = s.ensure('C:/w/whisper-server.exe', 'C:/w/models/ggml-base.bin');
  await vi.advanceTimersByTimeAsync(1000);
  await expect(url).resolves.toBe('http://127.0.0.1:4321/v1');
  expect(spawned).toHaveLength(1);
  expect(last().exe).toBe('C:/w/whisper-server.exe');
  expect(last().args).toEqual([
    '-m', 'C:/w/models/ggml-base.bin',
    '--host', '127.0.0.1',
    '--port', '4321',
    '-t', '3',
    '-l', 'auto',
    '--inference-path', '/v1/audio/transcriptions',
  ]);
  expect(fs.readFileSync(pidFile, 'utf8')).toBe(String(last().child.pid));
  expect(s.running()).toBe(true);
});

it('two jobs at once share one start', async () => {
  const s = make();
  const a = s.ensure('exe', 'm');
  const b = s.ensure('exe', 'm');
  await vi.advanceTimersByTimeAsync(1000);
  await expect(Promise.all([a, b])).resolves.toEqual(['http://127.0.0.1:4321/v1', 'http://127.0.0.1:4321/v1']);
  expect(spawned).toHaveLength(1);
});

it('a reply that is not whisper.cpp is never taken as ready', async () => {
  body = async () => '<title>nginx</title>';
  const s = make();
  const url = s.ensure('exe', 'm');
  const done = expect(url).rejects.toThrow('Built-in engine failed to start');
  await vi.advanceTimersByTimeAsync(60_000);
  await done;
  expect(last().child.killed).toBe(true);
  expect(s.running()).toBe(false);
});

it('an engine that exits while starting fails the start', async () => {
  body = () => new Promise(() => {}); // never answers
  const s = make();
  const url = s.ensure('exe', 'm');
  const done = expect(url).rejects.toThrow('Built-in engine failed to start');
  await vi.advanceTimersByTimeAsync(10);
  last().child.exit(1);
  await vi.advanceTimersByTimeAsync(10);
  await done;
  expect(s.running()).toBe(false);
});

it('unloads 5 minutes after the last job, and a new job resets the clock', async () => {
  const s = make();
  const first = s.ensure('exe', 'm');
  await vi.advanceTimersByTimeAsync(1000);
  await first;
  s.release();
  await vi.advanceTimersByTimeAsync(200_000);
  const again = s.ensure('exe', 'm');
  await vi.advanceTimersByTimeAsync(0);
  await again;
  s.release();
  await vi.advanceTimersByTimeAsync(299_999);
  expect(last().child.killed).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(last().child.killed).toBe(true);
  expect(s.running()).toBe(false);
  expect(fs.existsSync(pidFile)).toBe(false);
  expect(spawned).toHaveLength(1);
});

it('is never unloaded while a job is running', async () => {
  const s = make();
  const url = s.ensure('exe', 'm');
  await vi.advanceTimersByTimeAsync(1000);
  await url;
  await vi.advanceTimersByTimeAsync(600_000);
  expect(last().child.killed).toBe(false);
});

it('switching models restarts the engine', async () => {
  const s = make();
  const a = s.ensure('exe', 'base.bin');
  await vi.advanceTimersByTimeAsync(1000);
  await a;
  s.release();
  const b = s.ensure('exe', 'small.bin');
  await vi.advanceTimersByTimeAsync(1000);
  await b;
  expect(spawned).toHaveLength(2);
  expect(spawned[0].child.killed).toBe(true);
  expect(spawned[1].args[1]).toBe('small.bin');
});

it('an engine that dies is started again by the next job', async () => {
  const s = make();
  const a = s.ensure('exe', 'm');
  await vi.advanceTimersByTimeAsync(1000);
  await a;
  s.release();
  last().child.exit(3);
  expect(s.running()).toBe(false);
  const b = s.ensure('exe', 'm');
  await vi.advanceTimersByTimeAsync(1000);
  await b;
  expect(spawned).toHaveLength(2);
});

it('kills an engine left over from a crash, and only if it is whisper', () => {
  fs.writeFileSync(pidFile, '777');
  whisperPids.add(777);
  make().killOrphan();
  expect(killedPids).toEqual([777]);
  expect(fs.existsSync(pidFile)).toBe(false);

  fs.writeFileSync(pidFile, '888'); // reused by some other program
  make().killOrphan();
  expect(killedPids).toEqual([777]);
  expect(fs.existsSync(pidFile)).toBe(false);
});

it('stop kills the engine and clears the pid file', async () => {
  const s = make();
  const a = s.ensure('exe', 'm');
  await vi.advanceTimersByTimeAsync(1000);
  await a;
  s.stop();
  expect(last().child.killed).toBe(true);
  expect(fs.existsSync(pidFile)).toBe(false);
});

it('reports which model is loaded and whether a job holds it', async () => {
  const s = make();
  expect(s.loaded()).toBeNull();
  const a = s.ensure('exe', 'base.bin');
  await vi.advanceTimersByTimeAsync(1000);
  await a;
  expect(s.loaded()).toBe('base.bin');
  expect(s.inUse('base.bin')).toBe(true);
  expect(s.inUse('small.bin')).toBe(false);
  s.release();
  expect(s.inUse('base.bin')).toBe(false);
  s.stop();
  expect(s.loaded()).toBeNull();
});

it('stop resolves only once the engine has really exited', async () => {
  const s = make();
  const a = s.ensure('exe', 'm');
  await vi.advanceTimersByTimeAsync(1000);
  await a;
  FakeChild.slowKill = true;
  let done = false;
  const stopped = s.stop().then(() => (done = true));
  await vi.advanceTimersByTimeAsync(50);
  expect(last().child.killed).toBe(true);
  expect(done).toBe(false);
  last().child.exit(1);
  await stopped;
  expect(done).toBe(true);
});

it('stop gives up waiting after 3 s', async () => {
  const s = make();
  const a = s.ensure('exe', 'm');
  await vi.advanceTimersByTimeAsync(1000);
  await a;
  FakeChild.slowKill = true;
  const stopped = s.stop();
  await vi.advanceTimersByTimeAsync(3000);
  await expect(stopped).resolves.toBeUndefined();
});

it('an engine that cannot be launched fails the start at once', async () => {
  body = () => new Promise(() => {});
  const s = make();
  const url = s.ensure('exe', 'm');
  const done = expect(url).rejects.toThrow('Built-in engine failed to start');
  await vi.advanceTimersByTimeAsync(0);
  last().child.fail(Object.assign(new Error('spawn exe ENOENT'), { code: 'ENOENT' }));
  await vi.advanceTimersByTimeAsync(10);
  await done;
  expect(s.running()).toBe(false);
});

it('a start replaced while it waits for a port leaves no engine behind', async () => {
  let release!: (p: number) => void;
  const ports: Promise<number>[] = [new Promise((r) => (release = r)), Promise.resolve(5555)];
  const s = make({ freePort: () => ports.shift()! });
  const a = s.ensure('exe', 'base.bin');
  const aDone = a.catch((e: Error) => e.message);
  await vi.advanceTimersByTimeAsync(0);
  const b = s.ensure('exe', 'small.bin');
  await vi.advanceTimersByTimeAsync(0);
  release(4321);
  await vi.advanceTimersByTimeAsync(1000);
  await expect(b).resolves.toBe('http://127.0.0.1:5555/v1');
  await aDone;
  const alive = spawned.filter((x) => !x.child.killed);
  expect(alive).toHaveLength(1);
  expect(alive[0].args[1]).toBe('small.bin');
  expect(fs.readFileSync(pidFile, 'utf8')).toBe(String(alive[0].child.pid));
});

it('prewarm starts the engine and lets it idle out', async () => {
  const s = make();
  s.prewarm('exe', 'm');
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.running()).toBe(true);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(s.running()).toBe(false);
});
