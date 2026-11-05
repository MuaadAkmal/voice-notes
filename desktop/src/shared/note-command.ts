// Voice to lists: a dictation that starts with the wake word "Pixie" goes to the `commands` function,
// which picks the page and the items (no match: Quick notes). A name, not a word like "Note", so
// ordinary dictation ("note this down…") is never caught. It's fixed: not a setting.

export const DEFAULT_WAKE_WORDS = ['Pixie'];

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

/** A near miss ("Dixie" for "Pixie") only counts for names this long once spelled by sound: shorter ones are too close to real words. */
export const NEAR_MIN_LETTERS = 5;

/** How a command may start, after a near-miss name: ordinary dictation rarely starts like this. */
const COMMAND_START = /^(add|put|save|remember|note|learn|learned|learnt|i learned|i learnt|i just learned|how do you say|what's|what is|whats)\b/i;

/** Whether two sound keys differ by at most one letter (changed, added or dropped). */
function oneApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Whether the words after a near-miss name look like a command: a list verb first, or one of the user's page titles named. */
function looksLikeCommand(rest: string, pageTitles: readonly string[]): boolean {
  if (COMMAND_START.test(rest)) return true;
  const said = ` ${rest.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return pageTitles.some((t) => {
    const title = t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return title.length >= 3 && said.includes(` ${title} `);
  });
}

/**
 * The command after the wake word when `text` starts with one of `words` (optionally after "Hey"), else null.
 * With `pageTitles`, a name one sound off ("Dixie" for "Pixie") also counts, but only for names of
 * NEAR_MIN_LETTERS or more and when the rest looks like a command, so ordinary dictation still pastes.
 */
export function parseNoteCommand(text: string, words: readonly string[] = DEFAULT_WAKE_WORDS, opts?: { pageTitles?: readonly string[] }): { text: string } | null {
  const names = (words.length ? words : DEFAULT_WAKE_WORDS).map((w) => w.trim().split(/\s+/).map(soundKey)).filter((n) => n.join(''));
  const tokens = text.trim().replace(/^[\s,.:;!?"'-]+/, '').split(/(\s+)/); // words and the spaces between them
  const wordAt = (i: number) => tokens[i * 2] ?? '';
  const first = soundKey(wordAt(0));
  const start = GREETINGS.includes(first) && names.every((n) => n[0] !== first) ? 1 : 0;
  const restAfter = (count: number) =>
    tokens
      .slice((start + count) * 2 - 1)
      .join('')
      .replace(/^[\s,.:;!?-]+/, '')
      .replace(/[\s.!?"']+$/, '')
      .trim();
  for (const name of names) {
    if (!name.every((part, j) => soundKey(wordAt(start + j)) === part)) continue;
    const rest = restAfter(name.length);
    return rest ? { text: rest } : null;
  }
  if (!opts?.pageTitles) return null;
  for (const name of names) {
    const want = name.join('');
    const heard = name.map((_, j) => soundKey(wordAt(start + j))).join('');
    if (want.length < NEAR_MIN_LETTERS || !oneApart(want, heard)) continue;
    const rest = restAfter(name.length);
    if (rest && looksLikeCommand(rest, opts.pageTitles)) return { text: rest };
  }
  return null;
}

