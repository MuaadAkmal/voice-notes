// Wire types of the `asr` Edge Function (cloud transcription).

export type TranscribeResponse = {
  text: string;
  language: string | null;
  seconds: number;
  used: number;
  limit: number;
  resetsAt: string;
};

export type UsageResponse = { used: number; limit: number; resetsAt: string; plan: string };

export type AsrErrorCode = 'bad_audio' | 'too_large' | 'quota_exceeded' | 'provider_failed' | 'misconfigured';

/** Longest clip one request may send, in seconds. */
export const MAX_SECONDS = 300;
/** Largest request body, in bytes. */
export const MAX_BYTES = 10 * 1024 * 1024;
