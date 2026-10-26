import { MODEL_DISPLAY, MODEL_IDS, type ModelId } from '../../shared/transcription';

// Everything the built-in provider downloads, pinned to one engine build and one model revision.
// Hashes were recorded from the upstream files; a download that doesn't match is refused.

export type Asset = { file: string; bytes: number; sha256: string; urls: string[] };
export type ModelInfo = Asset & { id: ModelId; label: string; note: string; ramGb: number };

export const ENGINE_TAG = 'b5454';
const ENGINE_BASE = `https://github.com/ggml-org/whisper.cpp/releases/download/${ENGINE_TAG}`;
const MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
const MODEL_BASE = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}`;

const ENGINES: Record<string, Omit<Asset, 'urls'>> = {
  x64: {
    file: 'whisper-bin-x64.zip',
    bytes: 8_928_640,
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
  },
  arm64: {
    file: 'whisper-bin-win-cpu-arm64.zip',
    bytes: 4_371_193,
    sha256: '28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d',
  },
};

const MODEL_FILES: Record<ModelId, { file: string; sha256: string }> = {
  tiny: { file: 'ggml-tiny.bin', sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21' },
  'tiny.en': { file: 'ggml-tiny.en.bin', sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f' },
  base: { file: 'ggml-base.bin', sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' },
  'base.en': { file: 'ggml-base.en.bin', sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002' },
  small: { file: 'ggml-small.bin', sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b' },
  'small.en': { file: 'ggml-small.en.bin', sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d' },
  medium: { file: 'ggml-medium.bin', sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208' },
  'medium.en': { file: 'ggml-medium.en.bin', sha256: 'cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356' },
  'turbo-q5': { file: 'ggml-large-v3-turbo-q5_0.bin', sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2' },
  turbo: { file: 'ggml-large-v3-turbo.bin', sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69' },
};

export const MODELS: ModelInfo[] = MODEL_IDS.map((id) => ({
  id,
  ...MODEL_DISPLAY[id],
  ...MODEL_FILES[id],
  urls: [`${MODEL_BASE}/${MODEL_FILES[id].file}`],
}));

/** The CPU build for this architecture, or null when there is none (the card says "Not available on this PC"). */
export function engineFor(arch: string): Asset | null {
  const e = ENGINES[arch];
  return e ? { ...e, urls: [`${ENGINE_BASE}/${e.file}`] } : null;
}

export function modelInfo(id: ModelId): ModelInfo {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model ${id}`);
  return m;
}

const GB = 2 ** 30;

export function recommendedModel(totalMemBytes: number, cores: number): ModelId {
  if (totalMemBytes >= 8 * GB && cores >= 8) return 'turbo-q5';
  if (totalMemBytes >= 8 * GB) return 'small';
  return 'base';
}

/** One core left for the rest of the PC; whisper.cpp gains little past 8. */
export function threadsFor(cores: number): number {
  return Math.min(8, Math.max(1, cores - 1));
}

/** The files kept from the release zip: the server and the libraries it loads. */
export function ENGINE_FILES(name: string): boolean {
  return name === 'whisper-server.exe' || name === 'whisper.dll' || /^ggml.*\.dll$/.test(name);
}
