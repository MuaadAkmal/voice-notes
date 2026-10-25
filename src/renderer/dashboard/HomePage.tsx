import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import type { HomeWidget, Page } from '../../shared/channels';
import {
  addWidget,
  canAdd,
  moveWidget,
  removeWidget,
  renameWidget,
} from '../../shared/home-widgets';
import { AddWidgetDialog } from './AddWidgetDialog';
import { getDragging, setDragging, WIDGET_MIME } from './dnd';
import { HOME_FULL, useHomeWidgets } from './useHomeWidgets';
import { PageWidget } from './widgets/PageWidget';
import { QuickAddWidget } from './widgets/QuickAddWidget';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  pages: Page[] | null;
  onOpenPage: (id: string) => void;
};

export function HomePage({ pages, onOpenPage }: Props) {
  const { widgets, save, run } = useHomeWidgets();
  // The card a widget is being dragged over.
  const [dropId, setDropId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    open: boolean;
    type: HomeWidget['type'];
  }>({ open: false, type: 'quick-add' });

  // Another card being dragged (by its header) can drop here; it takes this card's position.
  const draggedWidget = (overId: string) => {
    const d = getDragging();
    return d?.kind === 'widget' && d.id !== overId ? d.id : null;
  };
  const dropProps = (id: string) => ({
    onDragEnter: (e: React.DragEvent) => {
      if (!draggedWidget(id)) return;
      e.preventDefault();
      setDropId(id);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!draggedWidget(id)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null))
        setDropId((d) => (d === id ? null : d));
    },
    onDrop: (e: React.DragEvent) => {
      const moved = draggedWidget(id);
      setDropId(null);
      if (!moved) return;
      e.preventDefault();
      setDragging(null);
      run((cur) => {
        const to = cur.findIndex((w) => w.id === id);
        return to < 0 ? cur : moveWidget(cur, moved, to);
      });
    },
  });

  const openDialog = (type: HomeWidget['type']) =>
    setDialog({ open: true, type });

  if (widgets === null) return null;
  const full = !canAdd(widgets);
  // A widget whose page isn't known (not loaded yet, or just deleted) renders nothing.
  const shown = widgets.flatMap((w) => {
    const page = pages?.find((p) => p.id === w.pageId);
    return page ? [{ widget: w, page }] : [];
  });

  return (
    <div className="@container mx-auto min-h-full max-w-5xl px-10 py-8">
      <header className="mb-7 flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Home
        </h1>
        {/* A disabled button shows no tooltip, so the wrapper carries it. */}
        <span title={full ? HOME_FULL : undefined}>
          <Button
            variant="outline"
            size="sm"
            disabled={full}
            onClick={() => openDialog('quick-add')}
          >
            <Plus />
            Add widget
          </Button>
        </span>
      </header>

      {pages && shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card px-8 py-14 text-center">
          <p className="font-display text-[15px] font-medium">
            Nothing on Home yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Jot down what you learn each day, or keep a note in view.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button size="sm" onClick={() => openDialog('quick-add')}>
              Add a quick-add box
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog('page')}
            >
              Show a page
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-4 @[900px]:grid-cols-2">
          {shown.map(({ widget, page }) => (
            <WidgetCard
              key={widget.id}
              id={widget.id}
              dropping={dropId === widget.id}
              dropProps={dropProps(widget.id)}
              title={widget.type === 'quick-add' ? widget.label : page.title}
              onTitleClick={
                widget.type === 'page' ? () => onOpenPage(page.id) : undefined
              }
              onOpenPage={() => onOpenPage(page.id)}
              onRename={
                widget.type === 'quick-add'
                  ? (label) => run((cur) => renameWidget(cur, widget.id, label))
                  : undefined
              }
              onRemove={() => run((cur) => removeWidget(cur, widget.id))}
            >
              {widget.type === 'quick-add' && (
                <QuickAddWidget
                  widget={widget}
                  page={page}
                  onOpenPage={onOpenPage}
                />
              )}
              {widget.type === 'page' && <PageWidget page={page} />}
            </WidgetCard>
          ))}
        </div>
      )}

      <AddWidgetDialog
        open={dialog.open}
        initialType={dialog.type}
        pages={pages ?? []}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onAdd={(w) => save((cur) => addWidget(cur, w))}
      />
    </div>
  );
}

type CardProps = {
  id: string;
  /** Another card is being dragged over this one. */
  dropping: boolean;
  dropProps: React.HTMLAttributes<HTMLElement>;
  title: string;
  /** Page widgets: the title opens the page. */
  onTitleClick?: () => void;
  onOpenPage: () => void;
  /** Quick-add widgets: rename the label inline. */
  onRename?: (label: string) => void;
  onRemove: () => void;
  children?: React.ReactNode;
};

function WidgetCard({
  id,
  dropping,
  dropProps,
  title,
  onTitleClick,
  onOpenPage,
  onRename,
  onRemove,
  children,
}: CardProps) {
  const [editing, setEditing] = useState(false);
  const editFromMenu = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLElement>(null);
  // Set once Enter or Escape has ended the edit, so the unmount blur can't commit again.
  const closed = useRef(false);

  useEffect(() => {
    if (editing) closed.current = false;
  }, [editing]);

  const commit = (value: string) => {
    if (closed.current) return;
    closed.current = true;
    setEditing(false);
    const label = value.trim();
    if (label && label !== title) onRename?.(label);
  };

  return (
    <section
      ref={card}
      {...dropProps}
      className={`min-w-0 rounded-2xl border bg-card p-5 transition-shadow ${dropping ? 'ring-2 ring-ring' : ''}`}
    >
      {/* The header is the drag handle; the whole card is the drag image. */}
      <header
        draggable={!editing}
        onDragStart={(e) => {
          setDragging({ kind: 'widget', id });
          e.dataTransfer.setData(WIDGET_MIME, id);
          e.dataTransfer.effectAllowed = 'move';
          const rect = card.current?.getBoundingClientRect();
          if (card.current && rect)
            e.dataTransfer.setDragImage(
              card.current,
              e.clientX - rect.left,
              e.clientY - rect.top,
            );
        }}
        onDragEnd={() => setDragging(null)}
        className="mb-3 flex cursor-grab items-center gap-2 active:cursor-grabbing"
      >
        {editing ? (
          <input
            ref={input}
            aria-label="Label"
            defaultValue={title}
            maxLength={60}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value);
              if (e.key === 'Escape') {
                closed.current = true;
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-0.5 font-display text-[15px] font-semibold outline-none focus:border-ring"
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold tracking-tight">
            {onTitleClick ? (
              <button onClick={onTitleClick} className="hover:underline">
                {title}
              </button>
            ) : (
              title
            )}
          </h2>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Widget options"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-40"
            // Focus the rename input once the menu has closed; while it is open the menu holds focus,
            // and returning focus to the trigger would blur (and commit) the input.
            onCloseAutoFocus={(e) => {
              if (editFromMenu.current) {
                e.preventDefault();
                editFromMenu.current = false;
                input.current?.select();
              }
            }}
          >
            <DropdownMenuItem onSelect={onOpenPage}>Open page</DropdownMenuItem>
            {onRename && (
              <DropdownMenuItem
                onSelect={() => {
                  editFromMenu.current = true;
                  setEditing(true);
                }}
              >
                Rename
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {children}
    </section>
  );
}
