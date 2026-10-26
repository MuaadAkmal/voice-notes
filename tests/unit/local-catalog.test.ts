import { expect, it } from 'vitest';
import {
  ENGINE_FILES,
  engineFor,
  MODELS,
  modelInfo,
  recommendedModel,
  threadsFor,
} from '../../src/main/local-whisper/catalog';
import { MODEL_DISPLAY, MODEL_IDS } from '../../src/shared/transcription';

const GB = 2 ** 30;

it('picks the engine build for the CPU architecture', () => {
  expect(engineFor('x64')).toMatchObject({
    file: 'whisper-bin-x64.zip',
    bytes: 8_928_640,
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
  });
  expect(engineFor('arm64')).toMatchObject({
    file: 'whisper-bin-win-cpu-arm64.zip',
    bytes: 4_371_193,
    sha256: '28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d',
  });
  expect(engineFor('ia32')).toBeNull();
});

it('pins every download to the engine tag or the model revision', () => {
  const urls = [...engineFor('x64')!.urls, ...engineFor('arm64')!.urls, ...MODELS.flatMap((m) => m.urls)];
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(url.includes('/b5454/') || url.includes('/5359861c739e955e79d9a303bcbc70fb988958b1/')).toBe(true);
    expect(url).not.toMatch(/\/main\/|latest/);
  }
});

it('lists every model once, in the shared order, with its pinned file', () => {
  expect(MODELS.map((m) => m.id)).toEqual(MODEL_IDS);
  expect(modelInfo('tiny')).toMatchObject({
    file: 'ggml-tiny.bin',
    bytes: 77_691_713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
  });
  expect(modelInfo('turbo-q5').file).toBe('ggml-large-v3-turbo-q5_0.bin');
  for (const m of MODELS) expect(m.bytes).toBe(MODEL_DISPLAY[m.id].bytes);
});

it('recommends a model from RAM and cores', () => {
  expect(recommendedModel(8 * GB, 8)).toBe('turbo-q5');
  expect(recommendedModel(8 * GB, 4)).toBe('small');
  expect(recommendedModel(8 * GB - 1, 16)).toBe('base');
});

it('leaves one core free, at most 8 threads', () => {
  expect(threadsFor(1)).toBe(1);
  expect(threadsFor(4)).toBe(3);
  expect(threadsFor(32)).toBe(8);
});

it('keeps only the files the server needs', () => {
  for (const f of ['whisper-server.exe', 'whisper.dll', 'ggml-cpu-haswell.dll', 'ggml.dll']) expect(ENGINE_FILES(f)).toBe(true);
  for (const f of ['whisper-cli.exe', 'SDL2.dll', 'llama.dll']) expect(ENGINE_FILES(f)).toBe(false);
});
