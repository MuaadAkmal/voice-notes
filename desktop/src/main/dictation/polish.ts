import log from 'electron-log/main';

// Dictated text tidied before it is pasted. Best effort within a time limit: signed out, offline,
// slow or refused, the transcript is pasted as it is, so cleanup can never lose a dictation.

const MIN_WORDS = 6; // "thanks, sounds good" has nothing to tidy and shouldn't wait for it
const BASE_MS = 1500;
const MS_PER_1000_CHARS = 1000; // longer text takes the model longer to write back
const MAX_MS = 4000;

export const polishBudgetMs = (chars: number) => Math.min(MAX_MS, BASE_MS + Math.round((chars / 1000) * MS_PER_1000_CHARS));

type Deps = {
  enabled(): boolean;
  polish(text: string, o: { signal: AbortSignal; timeoutMs: number }): Promise<{ text: string | null }>;
};

export async function polishDictation(text: string, signal: AbortSignal, d: Deps): Promise<string> {
  if (!d.enabled() || text.trim().split(/\s+/).length < MIN_WORDS) return text;
  try {
    return (await d.polish(text, { signal, timeoutMs: polishBudgetMs(text.length) })).text ?? text;
  } catch (err) {
    log.info('[dictation] pasted without cleanup:', err instanceof Error ? err.message : String(err));
    return text;
  }
}
