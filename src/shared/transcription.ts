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

/** provider null = not set up. Only the user's own OpenAI-compatible server exists for now. */
export type TranscriptionSettings = {
  provider: 'server' | null;
  baseUrl: string;
  model: string;
};

export const DEFAULT_TRANSCRIPTION: TranscriptionSettings = {
  provider: null,
  baseUrl: '',
  model: DEFAULT_MODEL,
};

/** Planned Voice Notes Cloud models, previewed on the Transcription page until the cloud backend ships. */
export const CLOUD_TIERS = [
  { name: 'Auto', detail: 'Picks the model by language' },
  { name: 'Fast', detail: 'Whisper large-v3 turbo' },
  { name: 'Most accurate', detail: 'Whisper large-v3' },
  { name: 'Indian languages', detail: 'Hindi, Tamil, Bengali and more' },
] as const;

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
