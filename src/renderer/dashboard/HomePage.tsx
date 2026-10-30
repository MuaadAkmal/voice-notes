import { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import type { HomeWidget, Page } from '../../shared/channels';
import {
  addWidget,
  canAdd,
  GRID_COLUMNS,
  hasCalendar,
  moveWidget,
  removeWidget,
  resizeWidget,
  spanFor,
  widgetSize,
} from '../../shared/home-widgets';
import { AddWidgetDialog } from './AddWidgetDialog';
import { getDragging, setDragging, WIDGET_MIME } from './dnd';
import { HOME_FULL, useHomeWidgets } from './useHomeWidgets';
import { PageWidget } from './widgets/PageWidget';
import { QuickAddWidget } from './widgets/QuickAddWidget';
import { CalendarWidget } from './widgets/CalendarWidget';
import { todayTitle } from '../../shared/calendar-format';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ROW_PX = 120;
const GAP_PX = 12;
/** Quick picks in the card menu; any size up to 4 × 4 can be dragged with the corner handle. */
const SIZE_PRESETS = [
  [1, 1],
  [1, 2],
  [2, 2],
  [2, 3],
  [4, 2],
] as const;

/** Columns that fit: 4 unless a cell would get narrower than ~150 px, then 2, then 1. */
const columnsFor = (width: number) =>
  width >= 640 ? GRID_COLUMNS : width >= 320 ? 2 : 1;

type GridMetrics = { cols: number; cellW: number };

type Props = {
  pages: Page[] | null;
  onOpenPage: (id: string) => void;
  onOpenConnectors: () => void;
};

export function HomePage({ pages, onOpenPage, onOpenConnectors }: Props) {
  const { widgets, save, run } = useHomeWidgets();
  // The card a widget is being dragged over.
  const [dropId, setDropId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    open: boolean;
    type: HomeWidget['type'];
  }>({ open: false, type: 'quick-add' });
  const [gridWidth, setGridWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  // Callback ref: the grid only exists once there is a widget to show.
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) =>
      setGridWidth(entry.contentRect.width),
    );
    observer.current.observe(el);
  }, []);

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
  const cols = columnsFor(gridWidth);
  const metrics: GridMetrics = {
    cols,
    cellW: (gridWidth - GAP_PX * (cols - 1)) / cols,
  };
  // A widget whose page isn't known (not loaded yet, or just deleted) renders nothing; the calendar has none.
  const shown = widgets.flatMap((w): { widget: HomeWidget; page: Page | null }[] => {
    if (w.type === 'calendar') return [{ widget: w, page: null }];
    const page = pages?.find((p) => p.id === w.pageId);
    return page ? [{ widget: w, page }] : [];
  });

  return (
    <div className="min-h-full px-6 py-6">
      <header className="mb-5 flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-semibold tracking-tight">
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
        <div
          ref={gridRef}
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: ROW_PX,
            gap: GAP_PX,
          }}
        >
          {shown.map(({ widget, page }) => (
            <WidgetCard
              key={widget.id}
              id={widget.id}
              size={widgetSize(widget)}
              metrics={metrics}
              onResize={(w, h) =>
                run((cur) => resizeWidget(cur, widget.id, w, h))
              }
              dropping={dropId === widget.id}
              dropProps={dropProps(widget.id)}
              // A card is named by its page, the same name voice commands use.
              title={page?.title ?? todayTitle(new Date())}
              onTitleClick={page ? () => onOpenPage(page.id) : undefined}
              onOpenPage={page ? () => onOpenPage(page.id) : undefined}
              onRemove={widget.locked ? undefined : () => run((cur) => removeWidget(cur, widget.id))}
            >
              {widget.type === 'quick-add' && page && (
                <QuickAddWidget page={page} />
              )}
              {widget.type === 'page' && page && <PageWidget page={page} newestFirst={!!widget.locked} />}
              {widget.type === 'calendar' && <CalendarWidget onOpenConnectors={onOpenConnectors} />}
            </WidgetCard>
          ))}
        </div>
      )}

      <AddWidgetDialog
        open={dialog.open}
        initialType={dialog.type}
        pages={pages ?? []}
        hasCalendar={hasCalendar(widgets)}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onAdd={(w) => save((cur) => addWidget(cur, w))}
      />
    </div>
  );
}

type CardProps = {
  id: string;
  size: { w: number; h: number };
  metrics: GridMetrics;
  onResize: (w: number, h: number) => void;
  /** Another card is being dragged over this one. */
  dropping: boolean;
  dropProps: React.HTMLAttributes<HTMLElement>;
  title: string;
  /** Page widgets: the title opens the page. */
  onTitleClick?: () => void;
  /** Absent for the calendar card, which has no page. */
  onOpenPage?: () => void;
  /** Absent for the locked Review later card. */
  onRemove?: () => void;
  children?: React.ReactNode;
};

function WidgetCard({
  id,
  size,
  metrics,
  onResize,
  dropping,
  dropProps,
  title,
  onTitleClick,
  onOpenPage,
  onRemove,
  children,
}: CardProps) {
  const card = useRef<HTMLElement>(null);
  // The size shown while the corner handle is dragged; cleared once the saved size arrives.
  const [preview, setPreview] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setPreview(null), [size.w, size.h]);
  const shown = preview ?? size;

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = card.current?.getBoundingClientRect();
    if (!rect || metrics.cellW <= 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const [x0, y0] = [e.clientX, e.clientY];
    let next = size;
    const move = (ev: PointerEvent) => {
      next = {
        w: Math.min(
          metrics.cols,
          spanFor(rect.width + ev.clientX - x0, metrics.cellW, GAP_PX),
        ),
        h: spanFor(rect.height + ev.clientY - y0, ROW_PX, GAP_PX),
      };
      setPreview(next);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      if (next.w === size.w && next.h === size.h) setPreview(null);
      else onResize(next.w, next.h);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  return (
    <section
      ref={card}
      {...dropProps}
      data-size={`${shown.w}x${shown.h}`}
      style={{
        gridColumn: `span ${Math.min(shown.w, metrics.cols)}`,
        gridRow: `span ${shown.h}`,
      }}
      className={`group relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card p-3 shadow-sm transition-shadow hover:shadow-md dark:shadow-none ${dropping ? 'ring-2 ring-ring' : ''}`}
    >
      {/* The header is the drag handle; the whole card is the drag image. */}
      <header
        draggable
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
        className="mb-2 flex shrink-0 cursor-grab items-center gap-2 active:cursor-grabbing"
      >
        <h2 className="min-w-0 flex-1 truncate font-display text-[13px] font-semibold tracking-tight">
          {onTitleClick ? (
            <button onClick={onTitleClick} className="hover:underline">
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Widget options"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {onOpenPage && <DropdownMenuItem onSelect={onOpenPage}>Open page</DropdownMenuItem>}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Size</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SIZE_PRESETS.map(([w, h]) => (
                  <DropdownMenuCheckboxItem
                    key={`${w}x${h}`}
                    checked={size.w === w && size.h === h}
                    onSelect={() => onResize(w, h)}
                  >
                    {w} × {h}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {onRemove && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  Remove
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div
        role="slider"
        aria-label="Resize widget"
        aria-valuetext={`${shown.w} by ${shown.h}`}
        onPointerDown={startResize}
        className="absolute right-0.5 bottom-0.5 grid size-4 cursor-se-resize touch-none place-items-center text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
      >
        <svg
          viewBox="0 0 10 10"
          className="size-2.5"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <path d="M9 3 3 9M9 6.5 6.5 9" />
        </svg>
      </div>
    </section>
  );
}
