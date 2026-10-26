import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Asset, ModelInfo } from '../../src/main/local-whisper/catalog';
import { type InstallerDeps, Installer } from '../../src/main/local-whisper/installer';

const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
const asset = (file: string, bytes: Uint8Array, urls = [`https://x/${file}`]): Asset => ({
  file,
  bytes: bytes.length,
  sha256: sha(bytes),
  urls,
});
const enc = (s: string) => new TextEncoder().encode(s);

const ZIP = zipSync({
  'Release/whisper-server.exe': enc('exe'),
  'Release/whisper.dll': enc('dll'),
  'Release/ggml.dll': enc('ggml'),
  'Release/ggml-cpu-haswell.dll': enc('cpu'),
  'Release/SDL2.dll': enc('sdl'),
  'Release/whisper-cli.exe': enc('cli'),
});
const MODEL = enc('model-bytes'.repeat(100));

let root: string;
let files: Record<string, Uint8Array | Error | 'stall'>;
let fetched: string[];
let changes: number;
let phases: string[];

const fakeFetch = (async (url: string, init?: RequestInit) => {
  fetched.push(url);
  const f = files[url];
  if (f === undefined) return new Response('nope', { status: 404 });
  if (f instanceof Error) throw f;
  if (f === 'stall') {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc('partial'));
        signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
      },
    });
    return new Response(body, { status: 200 });
  }
  return new Response(new Uint8Array(f), { status: 200 });
}) as unknown as typeof fetch;

function make(over: Partial<InstallerDeps> = {}, model: Partial<ModelInfo> = {}) {
  const engine = asset('whisper-bin-x64.zip', ZIP);
  const base: ModelInfo = {
    id: 'base',
    label: 'Base',
    note: '',
    ramGb: 0.5,
    ...asset('ggml-base.bin', MODEL),
    ...model,
  };
  files[engine.urls[0]] = ZIP;
  files[base.urls[0]] = MODEL;
  const inst: Installer = new Installer({
    root,
    arch: 'x64',
    fetch: fakeFetch,
    onChange: () => {
      changes++;
      const j = inst.job();
      if (j && phases[phases.length - 1] !== j.phase) phases.push(j.phase);
    },
    catalog: { engine, models: [base] },
    progressMs: 0,
    ...over,
  });
  return { inst, engine, base };
}

const parts = () =>
  fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).map(String).filter((f) => /\.part$|\.tmp$/.test(f)) : [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-whisper-'));
  files = {};
  fetched = [];
  changes = 0;
  phases = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('installs the engine, then the model', async () => {
  const { inst } = make();
  await inst.install('base');
  expect(inst.enginePath()).toBe(path.join(root, 'engine', 'b5454', 'whisper-server.exe'));
  const kept = fs.readdirSync(path.join(root, 'engine', 'b5454')).sort();
  expect(kept).toEqual(['ggml-cpu-haswell.dll', 'ggml.dll', 'whisper-server.exe', 'whisper.dll']);
  expect(inst.modelPath('base')).toBe(path.join(root, 'models', 'ggml-base.bin'));
  expect(fs.readFileSync(inst.modelPath('base')!)).toEqual(Buffer.from(MODEL));
  expect(phases).toEqual(['engine', 'model']);
  expect(inst.job()).toBeNull();
  expect(inst.installed()).toMatchObject({ engine: true, models: { base: true } });
  expect(parts()).toEqual([]);
});

it('skips the engine when it is already installed', async () => {
  const { inst, engine } = make();
  await inst.install('base');
  inst.remove('base');
  fetched = [];
  await inst.install('base');
  expect(fetched).not.toContain(engine.urls[0]);
});

it('rejects a corrupted download and keeps nothing', async () => {
  const { inst } = make({}, { sha256: '0'.repeat(64) });
  await expect(inst.install('base')).rejects.toThrow('Download was corrupted — try again');
  expect(inst.modelPath('base')).toBeNull();
  expect(parts()).toEqual([]);
  expect(inst.job()).toBeNull();
});

it('falls back to the next address when one fails', async () => {
  const { inst } = make({}, { urls: ['https://down/ggml-base.bin', 'https://mirror/ggml-base.bin'] });
  files['https://down/ggml-base.bin'] = new TypeError('fetch failed');
  files['https://mirror/ggml-base.bin'] = MODEL;
  await inst.install('base');
  expect(inst.modelPath('base')).not.toBeNull();
});

it('reports a failed download when every address fails', async () => {
  const { inst, base } = make();
  files[base.urls[0]] = new TypeError('fetch failed');
  await expect(inst.install('base')).rejects.toThrow('Download failed — check your connection');
  expect(parts()).toEqual([]);
});

it('cancel stops the download and leaves no partial file', async () => {
  const { inst, base } = make();
  files[base.urls[0]] = 'stall';
  const running = inst.install('base');
  await expect.poll(() => inst.job()?.phase).toBe('model');
  await new Promise((r) => setTimeout(r, 20));
  inst.cancel();
  await expect(running).rejects.toThrow('Cancelled');
  expect(inst.modelPath('base')).toBeNull();
  expect(parts()).toEqual([]);
  expect(inst.job()).toBeNull();
});

it('refuses a zip entry that climbs out of its folder', async () => {
  const bad = zipSync({ 'Release/whisper-server.exe': enc('exe'), 'Release/../../ggml-evil.dll': enc('x') });
  const { inst, engine, base } = make();
  files[engine.urls[0]] = bad;
  inst.setCatalog({ engine: asset('whisper-bin-x64.zip', bad), models: [base] });
  await expect(inst.install('base')).rejects.toThrow('Download was corrupted — try again');
  expect(inst.enginePath()).toBeNull();
  expect(fs.existsSync(path.join(root, '..', 'ggml-evil.dll'))).toBe(false);
});

it('runs one download at a time', async () => {
  const { inst, base } = make();
  files[base.urls[0]] = 'stall';
  const first = inst.install('base');
  await expect(inst.install('base')).rejects.toThrow('A download is already running');
  inst.cancel();
  await expect(first).rejects.toThrow('Cancelled');
});

it('a full disk says so', async () => {
  const { inst } = make({
    createWriteStream: () =>
      new Writable({
        write: (_chunk, _enc, done) => done(Object.assign(new Error('no space'), { code: 'ENOSPC' })),
      }) as unknown as fs.WriteStream,
  });
  await expect(inst.install('base')).rejects.toThrow('Not enough disk space');
  expect(parts()).toEqual([]);
});

it('cleanup removes leftovers from an interrupted run', () => {
  const { inst } = make();
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  fs.mkdirSync(path.join(root, 'engine', 'b5454.tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'models', 'ggml-base.bin.part'), 'x');
  fs.writeFileSync(path.join(root, 'engine', 'whisper-bin-x64.zip.part'), 'x');
  inst.cleanup();
  expect(parts()).toEqual([]);
});

it('remove deletes the model, and the engine when asked', async () => {
  const { inst } = make();
  await inst.install('base');
  expect(inst.diskBytes()).toBeGreaterThan(MODEL.length);
  inst.remove('base');
  expect(inst.installed()).toMatchObject({ engine: true, models: { base: false } });
  inst.remove('base', true);
  expect(inst.installed().engine).toBe(false);
  expect(inst.diskBytes()).toBe(0);
});

it('has no engine for an unsupported architecture', async () => {
  const { inst } = make({ catalog: { engine: null, models: [] } });
  expect(inst.installed().engine).toBe(false);
  await expect(inst.install('base')).rejects.toThrow('Not available on this PC');
});
