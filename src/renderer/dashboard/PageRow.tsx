import { useEffect, useRef, useState } from 'react';
import { FileText, MoreHorizontal, Star } from 'lucide-react';
import type { Page } from '../../shared/channels';
import { snippet } from '../../shared/markdown-snippet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  page: Page;
  selected: boolean;
  folderLabel?: string;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onToggleStar: () => void;
};

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/** A text page in the notes list. Click selects; double-click or Enter opens. */
export function PageRow(props: Props) {
  const {
    page,
    selected,
    folderLabel,
    onSelect,
    onOpen,
    onDragStart,
    onDragEnd,
  } = props;
  const { onRename, onDelete, onToggleStar } = props;
  const [editing, setEditing] = useState(false);
  const editFromMenu = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const text = snippet(page.body);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = (value: string) => {
    setEditing(false);
    const title = value.trim();
    if (title && title !== page.title) onRename(title);
  };

  // Ignore the row's own controls, and portal content (menus) whose React events bubble here.
  const fromRow = (e: React.SyntheticEvent) => {
    const target = e.target as HTMLElement;
    return e.currentTarget.contains(target) && !target.closest('button, input');
  };

  return (
    <li
      tabIndex={0}
      draggable={!editing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => fromRow(e) && onSelect(e)}
      onDoubleClick={(e) => fromRow(e) && onOpen()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen();
      }}
      aria-selected={selected}
      className={`group relative flex cursor-default select-none items-center gap-4 px-4 py-3 outline-none transition-colors focus-visible:bg-accent/50 ${
        selected
          ? 'bg-accent shadow-[inset_3px_0_0_0_var(--foreground)]'
          : 'hover:bg-accent/50'
      }`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <FileText className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={input}
            defaultValue={page.title}
            maxLength={200}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value);
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full rounded-md border border-input bg-background px-2 py-0.5 text-sm outline-none focus:border-ring"
          />
        ) : (
          <p className="truncate text-sm font-medium">{page.title}</p>
        )}
        {(text || folderLabel) && (
          <div className="mt-1 flex min-w-0 items-center gap-3">
            {folderLabel && (
              <span className="max-w-48 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {folderLabel}
              </span>
            )}
            {text && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {text}
              </span>
            )}
          </div>
        )}
      </div>

      <button
        aria-label={page.starred ? 'Unstar' : 'Star'}
        aria-pressed={page.starred}
        onClick={onToggleStar}
        className={`grid h-8 w-8 place-items-center rounded-md transition-opacity hover:bg-accent ${
          page.starred
            ? 'text-amber-500'
            : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        }`}
      >
        <Star
          className="size-4"
          fill={page.starred ? 'currentColor' : 'none'}
        />
      </button>
      {/* Lines the time up with voice notes' duration column. */}
      <span className="w-12" />
      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground/70">
        {timeOf(page.updatedAt)}
      </span>

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
          <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              editFromMenu.current = true;
              setEditing(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleStar}>
            {page.starred ? 'Unstar' : 'Star'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
