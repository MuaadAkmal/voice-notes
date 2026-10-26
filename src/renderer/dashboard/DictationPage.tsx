import { useCallback, useEffect, useState } from 'react';
import { Copy, Search } from 'lucide-react';
import type { Dictation } from '../../shared/channels';
import { filterDictations } from '../../shared/dictation';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { useConfirm } from './ConfirmDialog';
import { Kbd } from './NotesPage';
import { useToast } from './Toast';

const api = window.dashboardApi;
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** What was dictated in the last 24 hours, newest first, to copy again if a paste went astray. */
export function DictationPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Dictation[] | null>(null);
  const [query, setQuery] = useState('');
  const [hotkey, setHotkey] = useState('');

  const load = useCallback(() => api.listDictations().then(setList), []);
  useEffect(() => {
    load();
    const loadHotkey = () => api.getSettings().then((s) => setHotkey(s.dictationHotkeyLabel));
    loadHotkey();
    const offDictations = api.onDictationsChanged(load);
    const offSettings = api.onSettingsChanged(loadHotkey);
    return () => {
      offDictations();
      offSettings();
    };
  }, [load]);

  const copy = (id: string) =>
    api
      .copyDictation(id)
      .then(() => toast('Copied'))
      .catch((e) => toast(cleanIpcError(e)));

  const clearAll = async () => {
    if (!(await confirm({ title: 'Clear all dictations?', confirmLabel: 'Clear all' }))) return;
    await api.clearDictations().catch((e) => toast(cleanIpcError(e)));
  };

  if (!list) return null;
  const shown = filterDictations(list, query);

  return (
    <div className="mx-auto max-w-3xl px-10 py-9">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dictation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last 24 hours. Older dictations are deleted automatically.</p>
        </div>
        <Button variant="outline" size="sm" onClick={clearAll} disabled={list.length === 0}>
          Clear all
        </Button>
      </header>

      {list.length > 0 && (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            aria-label="Search dictations"
            placeholder="Search dictations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent pr-3 pl-8 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>
      )}

      {list.length === 0 ? (
        <p className="rounded-2xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          Hold <Kbd>{hotkey || 'Ctrl+Win'}</Kbd> in any app and speak. What you say is typed where your cursor is.
        </p>
      ) : shown.length === 0 ? (
        <p className="px-1 py-6 text-sm text-muted-foreground">No dictations match.</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border bg-card shadow-sm dark:shadow-none">
          {shown.map((d) => (
            <li key={d.id} data-testid="dictation-row" className="group flex items-start gap-4 px-5 py-3.5">
              <div className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{time(d.createdAt)}</div>
              <div className="min-w-0 flex-1">
                {d.app && <div className="mb-0.5 text-xs text-muted-foreground">{d.app}</div>}
                <p className="text-sm break-words whitespace-pre-wrap">{d.text}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Copy"
                title="Copy"
                onClick={() => copy(d.id)}
                className="shrink-0 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Copy className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
