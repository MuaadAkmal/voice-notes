// The user's own words (names, products, jargon) that every transcription is steered towards:
// Whisper gets them as its prompt, Scribe as key terms. Scribe's limits apply to all providers.

export const MAX_WORDS = 50;
const MAX_CHARS = 50;
const MAX_WORDS_PER_TERM = 5;

/** Trimmed, without the characters Scribe refuses, at most 5 words and 50 chars each, deduped ignoring case, at most 50. */
export function normalizeWords(words: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of words) {
    const w = raw.replace(/[<>{}[\]\\]/g, '').replace(/\s+/g, ' ').trim();
    if (!w || w.length > MAX_CHARS || w.split(' ').length > MAX_WORDS_PER_TERM) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length === MAX_WORDS) break;
  }
  return out;
}

/** Whisper's prompt for the list, or null when there is nothing to send. */
export function glossaryPrompt(words: readonly string[]): string | null {
  return words.length ? `Glossary: ${words.join(', ')}.` : null;
}
