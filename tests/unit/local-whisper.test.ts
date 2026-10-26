import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalWhisper } from '../../src/main/local-whisper';

let root: string;
const server = () => ({
  ensure: vi.fn(async () => 'http://127.0.0.1:9/v1'),
  release: vi.fn(),
  prewarm: vi.fn(),
  stop: vi.fn(async () => undefined),
  killOrphan: vi.fn(),
  inUse: vi.fn((_model: string) => false),
  loaded: vi.fn((): string | null => null),
});

let runtimeOk: boolean;

function make(s = server()) {
  const lw = new LocalWhisper({
    root,
    arch: 'x64',
    cores: 4,
    totalMem: 16 * 2 ** 30,
    fetch: fetch,
    onChange: () => undefined,
    server: s,
    runtimeOk: () => runtimeOk,
  });
  return { lw, s };
}

function fakeInstall() {
  fs.mkdirSync(path.join(root, 'engine', 'b5454'), { recursive: true });
  fs.writeFileSync(path.join(root, 'engine', 'b5454', 'whisper-server.exe'), 'x');
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  fs.writeFileSync(path.join(root, 'models', 'ggml-base.bin'), 'x');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-lw-'));
  runtimeOk = true;
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('reports what is installed and what it recommends', () => {
  fakeInstall();
  const { lw } = make();
  expect(lw.status()).toMatchObject({
    available: true,
    engine: true,
    models: { base: true, small: false },
    recommended: 'small',
    job: null,
  });
});

it('starts the engine with the installed files', async () => {
  fakeInstall();
  const { lw, s } = make();
  await expect(lw.ensure('base')).resolves.toBe('http://127.0.0.1:9/v1');
  expect(s.ensure).toHaveBeenCalledWith(
    path.join(root, 'engine', 'b5454', 'whisper-server.exe'),
    path.join(root, 'models', 'ggml-base.bin'),
  );
});

it('a model that is not downloaded says so instead of starting', async () => {
  const { lw, s } = make();
  await expect(lw.ensure('base')).rejects.toThrow('Built-in model missing — download it again');
  lw.prewarm('base');
  expect(s.ensure).not.toHaveBeenCalled();
  expect(s.prewarm).not.toHaveBeenCalled();
});

it('refuses to delete a model a job is using, and unloads an idle one first', async () => {
  fakeInstall();
  const s = server();
  const modelFile = path.join(root, 'models', 'ggml-base.bin');
  s.inUse.mockImplementation((m) => m === modelFile);
  const { lw } = make(s);
  await expect(lw.remove('base')).rejects.toThrow('That model is in use — try again in a moment');
  expect(fs.existsSync(modelFile)).toBe(true);

  s.inUse.mockReturnValue(false);
  s.loaded.mockReturnValue(modelFile);
  let exited!: () => void;
  s.stop.mockImplementation(() => new Promise<undefined>((r) => (exited = () => r(undefined))));
  const removing = lw.remove('base');
  await new Promise((r) => setTimeout(r, 10));
  expect(fs.existsSync(modelFile)).toBe(true); // the engine still has it open
  exited();
  await removing;
  expect(fs.existsSync(modelFile)).toBe(false);
});

it('refuses to delete anything while a download runs', async () => {
  fakeInstall();
  const { lw } = make();
  const stalled = new Promise<Response>(() => {});
  (lw as unknown as { installer: { d: { fetch: typeof fetch } } }).installer.d.fetch = (() => stalled) as typeof fetch;
  void lw.install('small').catch(() => undefined);
  await expect.poll(() => lw.status().job?.modelId).toBe('small');
  await expect(lw.remove('base', true)).rejects.toThrow('Wait for the download to finish');
  expect(lw.status().engine).toBe(true);
  lw.cancel();
});

it('a missing engine is reported as such, so it can be downloaded again', async () => {
  fakeInstall();
  fs.rmSync(path.join(root, 'engine'), { recursive: true });
  const { lw } = make();
  await expect(lw.ensure('base')).rejects.toThrow('Built-in engine missing — download it again');
});

it('without the Visual C++ runtime, says so instead of starting the engine', async () => {
  fakeInstall();
  runtimeOk = false;
  const { lw, s } = make();
  expect(lw.status().runtimeMissing).toBe(true);
  await expect(lw.ensure('base')).rejects.toThrow('Install the Microsoft Visual C++ runtime first');
  expect(s.ensure).not.toHaveBeenCalled();
});

it('boot clears leftovers and a crashed engine', () => {
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  fs.writeFileSync(path.join(root, 'models', 'ggml-base.bin.part'), 'x');
  const { lw, s } = make();
  lw.boot();
  expect(fs.existsSync(path.join(root, 'models', 'ggml-base.bin.part'))).toBe(false);
  expect(s.killOrphan).toHaveBeenCalled();
});
