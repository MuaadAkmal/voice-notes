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
  stop: vi.fn(),
  killOrphan: vi.fn(),
  inUse: vi.fn((_model: string) => false),
  loaded: vi.fn((): string | null => null),
});

function make(s = server()) {
  const lw = new LocalWhisper({
    root,
    arch: 'x64',
    cores: 4,
    totalMem: 16 * 2 ** 30,
    fetch: fetch,
    onChange: () => undefined,
    server: s,
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

it('refuses to delete a model a job is using, and unloads an idle one first', () => {
  fakeInstall();
  const s = server();
  const modelFile = path.join(root, 'models', 'ggml-base.bin');
  s.inUse.mockImplementation((m) => m === modelFile);
  const { lw } = make(s);
  expect(() => lw.remove('base')).toThrow('That model is in use — try again in a moment');
  expect(fs.existsSync(modelFile)).toBe(true);

  s.inUse.mockReturnValue(false);
  s.loaded.mockReturnValue(modelFile);
  lw.remove('base');
  expect(s.stop).toHaveBeenCalled();
  expect(fs.existsSync(modelFile)).toBe(false);
});

it('boot clears leftovers and a crashed engine', () => {
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  fs.writeFileSync(path.join(root, 'models', 'ggml-base.bin.part'), 'x');
  const { lw, s } = make();
  lw.boot();
  expect(fs.existsSync(path.join(root, 'models', 'ggml-base.bin.part'))).toBe(false);
  expect(s.killOrphan).toHaveBeenCalled();
});
