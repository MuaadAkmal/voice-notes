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
  onOpenChange,
  onAdd,
}: Props) {
  const toast = useToast();
  const [type, setType] = useState<WidgetType>(initialType);
  const [pageId, setPageId] = useState('');
  const [newName, setNewName] = useState('New words');
  const [label, setLabel] = useState('Learned today');
  const [busy, setBusy] = useState(false);
  // The page made by "New page…", kept across retries so a failed rename or save doesn't make another.
  const created = useRef<string | null>(null);

  // Each opening starts fresh, preset to the type the caller asked for.
  useEffect(() => {
    if (!open) return;
    setType(initialType);
    setPageId(pages.length === 0 ? NEW_PAGE : '');
    setNewName('New words');
    setLabel('Learned today');
    setBusy(false);
    created.current = null;
  }, [open]);

  const creating = pageId === NEW_PAGE;
  const valid =
    (creating
      ? newName.trim().length > 0
      : pages.some((p) => p.id === pageId)) &&
    (type === 'page' || label.trim().length > 0);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      let target = pageId;
      if (creating) {
        created.current ??= (await api.createPage(null)).id;
        await api.renamePage(created.current, newName.trim());
        target = created.current;
      }
      const id = crypto.randomUUID();
      await onAdd(
        type === 'quick-add'
          ? { id, type, pageId: target, label: label.trim() }
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
            className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
          >
            {(
              [
                ['quick-add', 'Quick add'],
                ['page', 'Show a page'],
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

          {creating && (
            <input
              aria-label="New page name"
              value={newName}
              maxLength={200}
              onChange={(e) => setNewName(e.target.value)}
              className={inputClass}
            />
          )}

          {type === 'quick-add' && (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Label
              <input
                value={label}
                maxLength={60}
                onChange={(e) => setLabel(e.target.value)}
                className={`${inputClass} font-normal`}
              />
            </label>
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
