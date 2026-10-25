import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import type { HomeWidget, Page } from '../../shared/channels';
import { cleanIpcError } from '../../shared/format';
import { addWidget, canAdd } from '../../shared/home-widgets';
import { AddWidgetDialog } from './AddWidgetDialog';
import { useToast } from './Toast';
import { QuickAddWidget } from './widgets/QuickAddWidget';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const api = window.dashboardApi;
const FULL = 'Home is full (24 widgets)';

type Props = {
  pages: Page[] | null;
  onOpenPage: (id: string) => void;
};

export function HomePage({ pages, onOpenPage }: Props) {
  const toast = useToast();
  // Always the latest list from settings:changed; every edit starts from it.
  const [widgets, setWidgets] = useState<HomeWidget[] | null>(null);
  const [dialog, setDialog] = useState<{
    open: boolean;
    type: HomeWidget['type'];
  }>({ open: false, type: 'quick-add' });

  useEffect(() => {
    const load = () => api.getSettings().then((s) => setWidgets(s.homeWidgets));
    load();
    return api.onSettingsChanged(load);
  }, []);

  const save = (next: HomeWidget[]) =>
    api
      .setSettings({ homeWidgets: next })
      .then((s) => setWidgets(s.homeWidgets))
      .catch((e) => toast(cleanIpcError(e)));

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
        <span title={full ? FULL : undefined}>
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

      {widgets.length === 0 ? (
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
              title={widget.type === 'quick-add' ? widget.label : page.title}
              onTitleClick={
                widget.type === 'page' ? () => onOpenPage(page.id) : undefined
              }
              onOpenPage={() => onOpenPage(page.id)}
              onRename={
                widget.type === 'quick-add'
                  ? (label) =>
                      save(
                        widgets.map((w) =>
                          w.id === widget.id && w.type === 'quick-add'
                            ? { ...w, label }
                            : w,
                        ),
                      )
                  : undefined
              }
              onRemove={() => save(widgets.filter((w) => w.id !== widget.id))}
            >
              {widget.type === 'quick-add' && (
                <QuickAddWidget
                  widget={widget}
                  page={page}
                  onOpenPage={onOpenPage}
                />
              )}
            </WidgetCard>
          ))}
        </div>
      )}

      <AddWidgetDialog
        open={dialog.open}
        initialType={dialog.type}
        pages={pages ?? []}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onAdd={(w) => save(addWidget(widgets, w))}
      />
    </div>
  );
}

type CardProps = {
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

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = (value: string) => {
    setEditing(false);
    const label = value.trim();
    if (label && label !== title) onRename?.(label);
  };

  return (
    <section className="min-w-0 rounded-2xl border bg-card p-5">
      <header className="mb-3 flex items-center gap-2">
        {editing ? (
          <input
            ref={input}
            aria-label="Label"
            defaultValue={title}
            maxLength={60}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value);
              if (e.key === 'Escape') setEditing(false);
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
            // Returning focus to the trigger would immediately blur (and commit) the rename input.
            onCloseAutoFocus={(e) => {
              if (editFromMenu.current) {
                e.preventDefault();
                editFromMenu.current = false;
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
