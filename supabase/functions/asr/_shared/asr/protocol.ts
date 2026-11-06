// Wire types of the `asr` Edge Function (cloud transcription).

export type TranscribeResponse = {
  text: string;
  language: string | null;
  seconds: number;
  used: number;
  limit: number;
  resetsAt: string;
  /** How long each step took, from the start of both; the app logs it. */
  ms?: { reserve?: number; provider?: number };
};

export type UsageResponse = { used: number; limit: number; resetsAt: string; plan: string };

/** Longest clip one request may send, in seconds. */
export const MAX_SECONDS = 300;
/** Largest request body, in bytes. */
export const MAX_BYTES = 10 * 1024 * 1024;

/** Most characters one polished-audio request may read. */
export const MAX_SPEAK_CHARS = 5000;
/** Premade ElevenLabs voices anyone may pick; 'clone' is the account's own copy. */
export const STOCK_VOICES: readonly { id: string; name: string }[] = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },
];

/** `voice` is a STOCK_VOICES id or 'clone'. */
export type SpeakRequest = { noteId: string; text: string; voice: string };
export type SpeakResponse = { seconds: number; used: number; limit: number; resetsAt: string };
