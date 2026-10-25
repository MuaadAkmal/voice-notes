import { useEffect, useRef, useState } from 'react';
import { Clapperboard, History, MoreHorizontal, Star, Volume2 } from 'lucide-react';
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
  onToggleStar: () => void;
  onSetShow: (show: string | null) => void;
};

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function NoteRow(props: Props) {
  const { note, selected, folderLabel, onSelect, onDragStart, onDragEnd } = props;
  const { playing, positionMs, onTogglePlay, onRename, onReveal, onDelete, onToggleStar, onSetShow } = props;
  const [editing, setEditing] = useState(false);
  const [editingShow, setEditingShow] = useState(false);
  const editFromMenu = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const showInput = useRef<HTMLInputElement>(null);
  const missing = note.status === 'missing';
  // MediaRecorder WebM has no duration header (<audio>.duration is Infinity), so progress uses the stored length.
  const progress = note.durationMs > 0 ? Math.min(1, Math.max(0, positionMs / note.durationMs)) : 0;

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  useEffect(() => {
    if (editingShow) showInput.current?.select();
  }, [editingShow]);

  const commitShow = (value: string) => {
    setEditingShow(false);
    const show = value.trim();
    if (show !== (note.show ?? '')) onSetShow(show || null);
  };

  const commit = (value: string) => {
    setEditing(false);
    const title = value.trim();
    if (title && title !== note.title) onRename(title);
  };

  return (
    <li
      draggable={!editing && !editingShow}
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
          {note.kind === 'rewind' && (
            <span
              title="Rewind: the last seconds of system audio, saved in film mode"
              className="flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-700 dark:text-sky-300"
            >
              <History className="size-3" />
              Rewind
            </span>
          )}
          {editingShow ? (
            <input
              ref={showInput}
              aria-label="Show"
              defaultValue={note.show ?? ''}
              placeholder="Show or film"
              maxLength={120}
              onBlur={(e) => commitShow(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitShow(e.currentTarget.value);
                if (e.key === 'Escape') setEditingShow(false);
              }}
              className="w-48 rounded border border-input bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-ring"
            />
          ) : (
            note.show && (
              <button
                onClick={() => setEditingShow(true)}
                title={note.windowTitle ? `Recorded over: ${note.windowTitle}\nClick to edit` : 'Click to edit'}
                className="flex max-w-48 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Clapperboard className="size-3 shrink-0" />
                <span className="truncate">{note.show}</span>
              </button>
            )
          )}
          {note.source !== 'mic' && note.kind !== 'rewind' && (
            <span title={note.source === 'both' ? 'Mic + system audio' : 'System audio'} className="text-muted-foreground">
              <Volume2 className="size-3.5" aria-label="Includes system audio" />
            </span>
          )}
          {folderLabel && (
            <span className="max-w-48 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {folderLabel}
            </span>
          )}
          {missing ? (
            <span className="text-xs text-destructive">File missing</span>
          ) : (
            note.durationMs > 0 && (
              <div className="h-1 w-40 min-w-12 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />
              </div>
            )
          )}
        </div>
      </div>

      <button
        aria-label={note.starred ? 'Unstar' : 'Star'}
        aria-pressed={note.starred}
        onClick={onToggleStar}
        className={`grid h-8 w-8 place-items-center rounded-md transition-opacity hover:bg-accent ${
          note.starred ? 'text-amber-500' : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        }`}
      >
        <Star className="size-4" fill={note.starred ? 'currentColor' : 'none'} />
      </button>
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
            if (editFromMenu.current) {
              e.preventDefault();
              editFromMenu.current = false;
            }
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              editFromMenu.current = true;
              setEditing(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              editFromMenu.current = true;
              setEditingShow(true);
            }}
          >
            {note.show ? 'Edit show' : 'Add show'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleStar}>{note.starred ? 'Unstar' : 'Star'}</DropdownMenuItem>
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
