import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MAX_WORDS, normalizeWords } from '../../shared/custom-words';

const INPUT = 'h-8 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

/** The user's own words (names, products, jargon) every transcription listens for. Synced between PCs. */
export function CustomWordsCard({ words, onChange }: { words: string[]; onChange: (words: string[]) => void }) {
  const [draft, setDraft] = useState('');
  // Edits apply here at once: the saved list comes back a moment later, and a word added before it
  // does must not start from the old one.
  const [list, setList] = useState(words);
  useEffect(() => setList(words), [words]);
  const save = (next: string[]) => {
    setList(next);
    onChange(next);
  };
  const full = list.length >= MAX_WORDS;
  const add = (text: string) => {
    const next = normalizeWords([...list, ...text.split(',')]);
    if (next.length !== list.length) save(next);
    setDraft('');
  };
  return (
    <section className="mt-8">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Custom words</h2>
        <span className="text-xs text-muted-foreground">
          {list.length} / {MAX_WORDS}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Names and words you say often. Used by every provider.</p>
      <div className="rounded-2xl border bg-card px-5 py-4">
        {list.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Custom words">
            {list.map((w) => (
              <li key={w} className="flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-sm">
                {w}
                <button
                  type="button"
                  aria-label={`Remove ${w}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  onClick={() => save(list.filter((x) => x !== w))}
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
