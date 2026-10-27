import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Pin, PinOff } from 'lucide-react';
import { EditorView } from '@codemirror/view';
import type { Page } from '../../shared/channels';
import { DebouncedSaver } from '../../shared/debounced-saver';
import { cleanIpcError } from '../../shared/format';
import { builtInPageId, canAdd, isPinned } from '../../shared/home-widgets';
import { MarkdownEditor } from './editor/MarkdownEditor';
import { shouldTakeRemoteBody } from '../../shared/sync/page-refresh';
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
  // The editor reads its text only when it mounts: a body from another PC remounts it (new key).
  const [editorKey, setEditorKey] = useState(0);
  const localBody = useRef(shown.body);
  // The stored text this editor's edits build on: what it loaded, then what it last saved. A save based
  // on text that changed underneath (another PC's edit while you typed) keeps the other text as a copy.
  const baseBody = useRef(shown.body);
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
        await api.setPageBody(shown.id, body, baseBody.current);
        baseBody.current = body;
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

  // Changed on another PC: show it, unless you're working in the page (your text wins locally, and the
  // server's keep-both rule settles it when your save syncs).
  useEffect(() => {
    const focused = !!editorHost.current?.contains(document.activeElement);
    if (shouldTakeRemoteBody({ dirty: saver.pending, focused, localBody: localBody.current, remoteBody: shown.body })) {
      localBody.current = shown.body;
      baseBody.current = shown.body;
      setEditorKey((k) => k + 1);
    }
  }, [shown.body, saver]);

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

  /** A click in the empty space beside or below the text puts the caret on the nearest line, not wherever it was. */
  const caretAtClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    const dom = editorHost.current?.querySelector<HTMLElement>('.cm-editor');
    const view = dom && EditorView.findFromDOM(dom);
    if (!view) return;
    e.preventDefault();
    const box = view.contentDOM.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, box.left + 1), box.right - 1);
    const pos = view.posAtCoords({ x, y: e.clientY }, false);
    view.focus();
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  };

  return (
    <div onMouseDown={caretAtClick} className="min-h-full px-10 py-6">
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
        onMouseDown={caretAtClick}
        className="mx-auto mt-4 min-h-[60vh] max-w-[720px] cursor-text"
      >
        <MarkdownEditor
          key={editorKey}
          value={shown.body}
          onChange={(body) => {
            localBody.current = body;
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
