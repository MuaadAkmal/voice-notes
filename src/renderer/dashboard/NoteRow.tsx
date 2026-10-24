import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Volume2 } from 'lucide-react';
import type { Note } from '../../shared/channels';
import { formatDuration } from '../../shared/format';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  note: Note;
  selected: boolean;
  folderLabel?: string; // shown in "All notes"
  onSelect: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  playing: boolean;
  positionMs: number;
  onTogglePlay: () => void;
  onRename: (title: string) => void;
  onReveal: () => void;
  onDelete: () => void;
};

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function NoteRow(props: Props) {
  const { note, selected, folderLabel, onSelect, onDragStart, onDragEnd } = props;
  const { playing, positionMs, onTogglePlay, onRename, onReveal, onDelete } = props;
  const [editing, setEditing] = useState(false);
  const renameFromMenu = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const missing = note.status === 'missing';
  // MediaRecorder WebM has no duration header (<audio>.duration is Infinity), so progress uses the stored length.
  const progress = note.durationMs > 0 ? Math.min(1, Math.max(0, positionMs / note.durationMs)) : 0;

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = (value: string) => {
    setEditing(false);
    const title = value.trim();
    if (title && title !== note.title) onRename(title);
  };

  return (
    <li
      draggable={!editing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        // Ignore the row's own controls, and portal content (menus) whose React events bubble here.
        if (!e.currentTarget.contains(target) || target.closest('button, input')) return;
        onSelect(e);
      }}
      aria-selected={selected}
      className={`group relative flex cursor-default select-none items-center gap-4 px-4 py-3 transition-colors ${
        selected ? 'bg-accent shadow-[inset_3px_0_0_0_var(--foreground)]' : 'hover:bg-accent/50'
      } ${missing ? 'opacity-50' : ''}`}
    >
      <button
        onClick={onTogglePlay}
        disabled={missing}
        aria-label={playing ? 'Pause' : 'Play'}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
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
            className="w-full rounded-md border border-input bg-background px-2 py-0.5 text-sm outline-none focus:border-ring"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            title="Click to rename"
            className="block max-w-full truncate text-left text-sm font-medium hover:underline hover:decoration-muted-foreground/40"
          >
            {note.title}
          </button>
        )}
        <div className="mt-1.5 flex items-center gap-3">
          {note.source !== 'mic' && (
            <span title={note.source === 'both' ? 'Mic + system audio' : 'System audio'} className="text-muted-foreground">
              <Volume2 className="size-3.5" aria-label="Includes system audio" />
            </span>
          )}
          {folderLabel && (
            <span className="max-w-48 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {folderLabel}
            </span>
          )}
          {missing ? (
            <span className="text-xs text-destructive">File missing</span>
          ) : (
            note.durationMs > 0 && (
              <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />
              </div>
            )
          )}
        </div>
      </div>

      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatDuration(note.durationMs)}</span>
      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground/70">{timeOf(note.createdAt)}</span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="More"
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44"
          // Returning focus to the trigger would immediately blur (and commit) the rename input.
          onCloseAutoFocus={(e) => {
            if (renameFromMenu.current) {
              e.preventDefault();
              renameFromMenu.current = false;
            }
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              renameFromMenu.current = true;
              setEditing(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          {!missing && <DropdownMenuItem onSelect={onReveal}>Show in folder</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
