import { X } from 'lucide-react';
import { useState } from 'react';
import { MAX_WORDS, normalizeWords } from '../../shared/custom-words';

const INPUT = 'h-8 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

/** The user's own words (names, products, jargon) every transcription listens for. Synced between PCs. */
export function CustomWordsCard({ words, onChange }: { words: string[]; onChange: (words: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const full = words.length >= MAX_WORDS;
  const add = (text: string) => {
    const next = normalizeWords([...words, ...text.split(',')]);
    if (next.length !== words.length) onChange(next);
    setDraft('');
  };
  return (
    <section className="mt-8">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Custom words</h2>
        <span className="text-xs text-muted-foreground">
          {words.length} / {MAX_WORDS}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Names and words you say often. Used by every provider.</p>
      <div className="rounded-2xl border bg-card px-5 py-4">
        {words.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Custom words">
            {words.map((w) => (
              <li key={w} className="flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-sm">
                {w}
                <button
                  type="button"
                  aria-label={`Remove ${w}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  onClick={() => onChange(words.filter((x) => x !== w))}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          aria-label="Add a word"
          placeholder={full ? 'The list is full' : 'Add a word'}
          disabled={full}
          maxLength={200}
          className={`${INPUT} w-full`}
          value={draft}
          // A comma adds what was typed before it.
          onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
        />
      </div>
    </section>
  );
}
