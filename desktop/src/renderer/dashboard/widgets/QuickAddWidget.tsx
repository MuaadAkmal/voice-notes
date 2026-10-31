import { useRef, useState } from 'react';
import type { Page } from '../../../shared/channels';
import { cleanIpcError } from '../../../shared/format';
import { todayEntries } from '../../../shared/learn-log';
import { useToast } from '../Toast';

const api = window.dashboardApi;

type Props = { page: Page };

/** "Learned today" box: each entry is appended to the page under today's heading. */
export function QuickAddWidget({ page }: Props) {
  const toast = useToast();
  const [text, setText] = useState('');
  const entries = todayEntries(page.body, new Date());

  // One append at a time: a second Enter while one is in flight is ignored.
  const pending = useRef(false);

  const submit = async () => {
    const entry = text.trim();
    if (!entry || pending.current) return;
    pending.current = true;
    try {
      await api.appendPageEntry(page.id, entry);
      // Cleared only once saved, and only if the text wasn't changed meanwhile.
      setText((cur) => (cur.trim() === entry ? '' : cur));
    } catch (e) {
      toast(cleanIpcError(e));
    } finally {
      pending.current = false;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        aria-label={`Add entry to ${page.title || 'Untitled'}`}
        placeholder="Type and press Enter"
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Today
        </p>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">Nothing yet today</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-xs">
            {entries.map((entry, i) => (
              <li key={i} className="break-words">
                {entry}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
