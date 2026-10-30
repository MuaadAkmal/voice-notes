// Voice to lists: a dictation that starts with one of the user's wake words (a name, "Pixie" unless
// changed) goes to the `commands` function, which picks the page and the items (no match: Quick notes).
// A name, not a word like "Note", so ordinary dictation ("note this down…") is never caught.

export const DEFAULT_WAKE_WORDS = ['Pixie'];
export const MAX_WAKE_WORDS = 10;

/**
 * How a name sounds, roughly, so Whisper's spellings of it compare equal: "Pixie", "Pixy" and "Pixi"
 * all give "piksi", "Ziggy" and "Ziggie" give "zigi". "Pixel" stays different.
 */
export function soundKey(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/ck|c(?=[aou])|q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/(ie|ee|ey|y|ea)$/, 'i')
    .replace(/(.)\1+/g, '$1');
}

const GREETINGS = ['hey', 'hi', 'ok', 'okay'].map(soundKey);

/** The command after the wake word when `text` starts with one of `words` (optionally after "Hey"), else null. */
export function parseNoteCommand(text: string, words: readonly string[] = DEFAULT_WAKE_WORDS): { text: string } | null {
  const names = (words.length ? words : DEFAULT_WAKE_WORDS).map((w) => w.trim().split(/\s+/).map(soundKey)).filter((n) => n.join(''));
  const tokens = text.trim().replace(/^[\s,.:;!?"'-]+/, '').split(/(\s+)/); // words and the spaces between them
  const wordAt = (i: number) => tokens[i * 2] ?? '';
  const first = soundKey(wordAt(0));
  const start = GREETINGS.includes(first) && names.every((n) => n[0] !== first) ? 1 : 0;
  for (const name of names) {
    if (!name.every((part, j) => soundKey(wordAt(start + j)) === part)) continue;
    const rest = tokens
      .slice((start + name.length) * 2 - 1)
      .join('')
      .replace(/^[\s,.:;!?-]+/, '')
      .replace(/[\s.!?"']+$/, '')
      .trim();
    return rest ? { text: rest } : null;
  }
  return null;
}
