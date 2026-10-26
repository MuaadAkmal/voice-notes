/** Languages offered in the Transcribe menu, in display order. Codes are ISO 639-1, as Whisper takes them. */
export const TRANSCRIBE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ar', name: 'Arabic' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ur', name: 'Urdu' },
  { code: 'nl', name: 'Dutch' },
] as const;

export type TranscribeLanguage =
  | 'auto'
  | (typeof TRANSCRIBE_LANGUAGES)[number]['code'];

export const LANGUAGE_CODES = [
  'auto',
  ...TRANSCRIBE_LANGUAGES.map((l) => l.code),
] as ['auto', ...Exclude<TranscribeLanguage, 'auto'>[]];

export const DEFAULT_MODEL = 'openai/whisper-large-v3';

/** Built-in (whisper.cpp) models, in the order the picker lists them. */
export const MODEL_IDS = [
  'tiny',
  'tiny.en',
  'base',
  'base.en',
  'small',
  'small.en',
  'medium',
  'medium.en',
  'turbo-q5',
  'turbo',
] as const;

export type ModelId = (typeof MODEL_IDS)[number];

/** What the picker shows for each model. `bytes` is the download size. */
export const MODEL_DISPLAY: Record<ModelId, { label: string; note: string; bytes: number; ramGb: number }> = {
  tiny: { label: 'Tiny', note: 'Fastest, rough accuracy', bytes: 77_691_713, ramGb: 0.4 },
  'tiny.en': { label: 'Tiny (English)', note: 'Fastest, English only', bytes: 77_704_715, ramGb: 0.4 },
  base: { label: 'Base', note: 'Fast, decent accuracy', bytes: 147_951_465, ramGb: 0.5 },
  'base.en': { label: 'Base (English)', note: 'Fast, English only', bytes: 147_964_211, ramGb: 0.5 },
  small: { label: 'Small', note: 'Balanced speed and accuracy', bytes: 487_601_967, ramGb: 1 },
  'small.en': { label: 'Small (English)', note: 'Balanced, English only', bytes: 487_614_201, ramGb: 1 },
  medium: { label: 'Medium', note: 'Accurate, slow on most PCs', bytes: 1_533_763_059, ramGb: 2.6 },
  'medium.en': { label: 'Medium (English)', note: 'Accurate, English only', bytes: 1_533_774_781, ramGb: 2.6 },
  'turbo-q5': { label: 'Large-v3 Turbo (compact)', note: 'Best for most PCs', bytes: 574_041_195, ramGb: 1.5 },
  turbo: { label: 'Large-v3 Turbo', note: 'Best, needs a strong CPU', bytes: 1_624_555_275, ramGb: 3 },
};

/** provider null = not set up; 'server' = the user's own OpenAI-compatible server; 'local' = built-in whisper.cpp. */
export type TranscriptionSettings = {
  provider: 'server' | 'local' | null;
  baseUrl: string;
  model: string;
  localModel: ModelId | null;
};

export const DEFAULT_TRANSCRIPTION: TranscriptionSettings = {
  provider: null,
  baseUrl: '',
  model: DEFAULT_MODEL,
  localModel: null,
};

/** Planned Voice Notes Cloud models, previewed on the Transcription page until the cloud backend ships. */
export const CLOUD_TIERS = [
  { name: 'Auto', detail: 'Picks the model by language' },
  { name: 'Fast', detail: 'Whisper large-v3 turbo' },
  { name: 'Most accurate', detail: 'Whisper large-v3' },
  { name: 'Indian languages', detail: 'Hindi, Tamil, Bengali and more' },
] as const;

/** whisper.cpp answers silence with markers like "[BLANK_AUDIO]": text made only of markers means no speech. */
export function cleanTranscript(text: string): string {
  const trimmed = text.trim();
  return trimmed.replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim() === '' ? '' : trimmed;
}

/** http(s) URL without query, hash or trailing slashes; a pasted full endpoint is cut back to its base. */
export function normaliseBaseUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return `${url.origin}${url.pathname}`
    .replace(/\/+$/, '')
    .replace(/\/audio\/transcriptions$/, '')
    .replace(/\/+$/, '');
}

/** A two-letter code as-is, an English name from the table as its code, anything else null. */
export function normaliseLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(s)) return s;
  return (
    TRANSCRIBE_LANGUAGES.find((l) => l.name.toLowerCase() === s)?.code ?? null
  );
}

/** Plain http to anything but this machine. */
export function sendsKeyInsecurely(baseUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(baseUrl);
    if (protocol !== 'http:') return false;
    return !(
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
}
