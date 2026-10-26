import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Pin, PinOff } from 'lucide-react';
import type { Page } from '../../shared/channels';
import { DebouncedSaver } from '../../shared/debounced-saver';
import { cleanIpcError } from '../../shared/format';
import { builtInPageId, canAdd, isPinned } from '../../shared/home-widgets';
import { MarkdownEditor } from './editor/MarkdownEditor';
import { useToast } from './Toast';
import { HOME_FULL, useHomeWidgets } from './useHomeWidgets';

const api = window.dashboardApi;
const SAVE_DELAY_MS = 500;

type Props = {
  /** Undefined once the page has been deleted; App then falls back to another view. */
  page: Page | undefined;
  /** Just created: focus the title with its text selected. */
  fresh: boolean;
  onBack: () => void;
};

/** One text page: editable title and the markdown body, autosaved. Remount (key) per page. */
export function PageView({ page, fresh, onBack }: Props) {
  const toast = useToast();
  // Keep showing the last known page for the render in which it disappears.
  const last = useRef(page!);
  if (page) last.current = page;
  const shown = last.current;
  const gone = useRef(false);

  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [title, setTitle] = useState(shown.title);
  const titleInput = useRef<HTMLInputElement>(null);
  const editorHost = useRef<HTMLDivElement>(null);
  const home = useHomeWidgets();
  const pinned = isPinned(home.widgets ?? [], shown.id);
  const pinDisabled = home.widgets === null || (!pinned && !canAdd(home.widgets));

  const onSaveError = () => {
    setStatus('error');
    toast("Couldn't save");
  };

  const [saver] = useState(() => {
    const s: DebouncedSaver<string> = new DebouncedSaver<string>(
      async (body) => {
        await api.setPageBody(shown.id, body);
        if (!s.pending) setStatus('saved');
      },
      SAVE_DELAY_MS,
      onSaveError,
    );
    return s;
  });
  const flush = () => {
    if (!gone.current) saver.flush().catch(onSaveError);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Deleted elsewhere: drop unsaved text rather than saving into a page that no longer exists.
  useEffect(() => {
    if (!page) {
      gone.current = true;
      saver.cancel();
    }
  }, [page, saver]);

  useEffect(() => {
    const onUnload = () => flushRef.current();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      flushRef.current(); // leaving the page (navigation) saves at once
    };
  }, []);

  useEffect(() => {
    if (fresh) titleInput.current?.select(); // select() also focuses
  }, [fresh]);

  // Renamed elsewhere (e.g. from the list): follow, unless the title is being edited here.
  useEffect(() => {
    if (document.activeElement !== titleInput.current) setTitle(shown.title);
  }, [shown.title]);

  const commitTitle = () => {
    const next = title.trim();
    if (!next || gone.current) {
      setTitle(shown.title);
      return;
    }
    setTitle(next);
    if (next !== shown.title)
      api.renamePage(shown.id, next).catch((e) => toast(cleanIpcError(e)));
  };

  const focusEditor = () =>
    editorHost.current?.querySelector<HTMLElement>('.cm-content')?.focus();

  return (
    <div className="min-h-full px-10 py-6">
      <header className="mx-auto max-w-[720px]">
        <div className="mb-5 flex items-center justify-between">
          <button
            aria-label="Back"
            title="Back"
            onClick={onBack}
            className="-ml-2 grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex items-center gap-3">
            <span
              aria-live="polite"
              className={`text-xs ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {status === 'saving' ? 'Saving…' : status === 'error' ? 'Not saved' : 'Saved'}
            </span>
            {/* A disabled button shows no tooltip, so the wrapper carries it. The built-in page is always on Home. */}
            {builtInPageId(home.widgets) !== shown.id && (
              <span title={pinDisabled && home.widgets ? HOME_FULL : undefined}>
                <button
                  aria-label={pinned ? 'Unpin from Home' : 'Pin to Home'}
                  title={pinned ? 'Unpin from Home' : 'Pin to Home'}
                  aria-pressed={pinned}
                  disabled={pinDisabled}
                  onClick={() => home.togglePin(shown.id)}
                  className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                </button>
              </span>
            )}
          </div>
        </div>
        <input
          ref={titleInput}
          aria-label="Title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              focusEditor(); // blurs the title, which commits it
            }
          }}
          className="w-full bg-transparent font-display text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
        />
      </header>
      <div
        ref={editorHost}
        // Clicks in the empty space below the text land in the editor.
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          focusEditor();
        }}
        className="mx-auto mt-4 min-h-[60vh] max-w-[720px] cursor-text"
      >
        <MarkdownEditor
          value={shown.body}
          onChange={(body) => {
            saver.push(body);
            setStatus('saving');
          }}
          onBlur={flush}
          onError={toast}
        />
      </div>
    </div>
  );
}
