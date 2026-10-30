// Voice to folders: a voice note that starts "Pixie, movie lines …" is filed into the folder of that name.
// Only the first seconds are transcribed to check; the name is matched here, by sound, with no LLM.
import { parseNoteCommand, soundKey } from './note-command';

export const PEEK_SECONDS = 4;
const MAX_NAME_WORDS = 4;

const key = (words: string[]) => words.map(soundKey).join('');

/** The folder named right after the wake word (the longest name that fits), else null. */
export function matchFolderCommand<F extends { id: string; name: string }>(
  transcript: string,
  wakeWords: readonly string[],
  folders: readonly F[],
): F | null {
  const cmd = parseNoteCommand(transcript, wakeWords);
  if (!cmd) return null;
  const words = cmd.text.replace(/^(to|in|into)\s+/i, '').split(/[\s,.:;!?]+/).filter(Boolean);
  const byKey = new Map<string, F>();
  for (const f of folders) {
    const k = key(f.name.split(/\s+/));
    if (k && !byKey.has(k)) byKey.set(k, f);
  }
  for (let n = Math.min(MAX_NAME_WORDS, words.length); n > 0; n--) {
    const hit = byKey.get(key(words.slice(0, n)));
    if (hit) return hit;
  }
  return null;
}
