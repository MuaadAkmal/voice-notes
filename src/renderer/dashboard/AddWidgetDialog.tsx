import { useEffect, useRef, useState } from 'react';
import type { HomeWidget, Page } from '../../shared/channels';
import { cleanIpcError } from '../../shared/format';
import { useToast } from './Toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const api = window.dashboardApi;
// Radix Select can't hold an empty value; this stands for "create a page".
const NEW_PAGE = '__new';

type WidgetType = HomeWidget['type'];
type Props = {
  open: boolean;
  initialType: WidgetType;
  pages: Page[];
  /** Home already has the Today's calendar card (there is only ever one). */
  hasCalendar: boolean;
  onOpenChange: (open: boolean) => void;
  /** Saves the widget; the dialog stays open until it resolves. */
  onAdd: (w: HomeWidget) => Promise<void>;
};

const inputClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

export function AddWidgetDialog({
  open,
  initialType,
  pages,
  hasCalendar,
  onOpenChange,
  onAdd,
}: Props) {
  const toast = useToast();
  const [type, setType] = useState<WidgetType>(initialType);
  const [pageId, setPageId] = useState('');
  const [newName, setNewName] = useState('New words');
  const [busy, setBusy] = useState(false);
  // The page made by "New page…", kept across retries so a failed rename or save doesn't make another.
  const created = useRef<string | null>(null);

  // Each opening starts fresh, preset to the type the caller asked for.
  useEffect(() => {
    if (!open) return;
    setType(initialType);
    setPageId(pages.length === 0 ? NEW_PAGE : '');
    setNewName('New words');
    setBusy(false);
    created.current = null;
  }, [open]);

  const creating = pageId === NEW_PAGE;
  const valid =
    type === 'calendar' ||
    ((creating
      ? newName.trim().length > 0
      : pages.some((p) => p.id === pageId)));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (type === 'calendar') {
        await onAdd({ id: crypto.randomUUID(), type });
        onOpenChange(false);
        return;
      }
      let target = pageId;
      let title = pages.find((p) => p.id === pageId)?.title ?? '';
      if (creating) {
        created.current ??= (await api.createPage(null)).id;
        title = newName.trim();
        await api.renamePage(created.current, title);
        target = created.current;
      }
      const id = crypto.randomUUID();
      await onAdd(
        type === 'quick-add'
          ? // The card shows its page's title; label stays filled in for older builds, which require one.
            { id, type, pageId: target, label: (title || 'Quick add').slice(0, 60) }
          : { id, type, pageId: target },
      );
      onOpenChange(false);
    } catch (e) {
      toast(cleanIpcError(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Add widget</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div
            role="group"
            aria-label="Widget type"
            className={`grid gap-1 rounded-lg bg-muted p-1 ${hasCalendar ? 'grid-cols-2' : 'grid-cols-3'}`}
          >
            {(
              [
                ['quick-add', 'Quick add'],
                ['page', 'Show a page'],
                ...(hasCalendar ? [] : ([['calendar', "Today's calendar"]] as const)),
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                onClick={() => setType(value)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:shadow-sm"
              >
                {text}
              </button>
            ))}
          </div>

          {type === 'calendar' ? (
            <p className="text-sm text-muted-foreground">
              Today's events from your Google Calendar. Connect it on the Connectors page.
            </p>
          ) : (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Page
            <Select value={pageId} onValueChange={setPageId}>
              <SelectTrigger className="w-full" aria-label="Page">
                <SelectValue placeholder="Choose a page" />
              </SelectTrigger>
              <SelectContent>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
                {pages.length > 0 && <SelectSeparator />}
                <SelectItem value={NEW_PAGE}>New page…</SelectItem>
              </SelectContent>
            </Select>
          </label>
          )}

          {type !== 'calendar' && creating && (
            <input
              aria-label="New page name"
              value={newName}
              maxLength={200}
              onChange={(e) => setNewName(e.target.value)}
              className={inputClass}
            />
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              Add widget
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
