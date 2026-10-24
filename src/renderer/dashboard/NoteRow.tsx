import { useEffect, useRef, useState } from 'react';
import type { Note } from '../../shared/channels';
import { formatDuration } from '../../shared/format';

type Props = {
  note: Note;
  playing: boolean;
  positionMs: number;
  onTogglePlay: () => void;
  onRename: (title: string) => void;
  onReveal: () => void;
  onDelete: () => void;
};

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function NoteRow({ note, playing, positionMs, onTogglePlay, onRename, onReveal, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const missing = note.status === 'missing';
  // MediaRecorder WebM has no duration header (<audio>.duration is Infinity), so progress uses the stored length.
  const progress = note.durationMs > 0 ? Math.min(1, Math.max(0, positionMs / note.durationMs)) : 0;

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  const commit = (value: string) => {
    setEditing(false);
    const title = value.trim();
    if (title && title !== note.title) onRename(title);
  };

  return (
    <li className={`group relative flex items-center gap-4 px-4 py-3 ${missing ? 'opacity-50' : ''}`}>
      <button
        onClick={onTogglePlay}
        disabled={missing}
        aria-label={playing ? 'Pause' : 'Play'}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-900 text-white transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 h-3.5 w-3.5" fill="currentColor">
            <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={input}
            defaultValue={note.title}
            maxLength={200}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value);
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full rounded-md border border-stone-300 px-2 py-0.5 text-sm outline-none focus:border-stone-500"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            title="Click to rename"
            className="block max-w-full truncate text-left text-sm font-medium hover:underline hover:decoration-stone-300"
          >
            {note.title}
          </button>
        )}
        <div className="mt-1.5 flex items-center gap-3">
          {missing ? (
            <span className="text-xs text-red-600">File missing</span>
          ) : (
            note.durationMs > 0 && (
              <div className="h-1 w-40 overflow-hidden rounded-full bg-stone-200">
                <div className="h-full rounded-full bg-stone-800" style={{ width: `${progress * 100}%` }} />
              </div>
            )
          )}
        </div>
      </div>

      <span className="w-12 text-right text-xs tabular-nums text-stone-500">{formatDuration(note.durationMs)}</span>
      <span className="w-12 text-right text-xs tabular-nums text-stone-400">{timeOf(note.createdAt)}</span>

      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          aria-label="More"
          className="grid h-8 w-8 place-items-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-9 z-10 w-44 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 text-sm shadow-lg">
            <MenuItem onClick={() => setEditing(true)}>Rename</MenuItem>
            {!missing && <MenuItem onClick={onReveal}>Show in folder</MenuItem>}
            <MenuItem danger onClick={onDelete}>
              Delete
            </MenuItem>
          </div>
        )}
      </div>
    </li>
  );
}

function MenuItem({ children, danger, onClick }: { children: React.ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left hover:bg-stone-100 ${danger ? 'text-red-600' : 'text-stone-700'}`}
    >
      {children}
    </button>
  );
}
