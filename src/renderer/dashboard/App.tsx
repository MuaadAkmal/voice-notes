import { useCallback, useEffect, useState } from 'react';
import type { Folder, Note, Page } from '../../shared/channels';
import { cleanIpcError } from '../../shared/format';
import { NO_FILTER, type NoteFilter } from '../../shared/search';
import { DictationPage } from './DictationPage';
import { HomePage } from './HomePage';
import { Logo } from './Logo';
import { NotesPage } from './NotesPage';
import { PageView } from './PageView';
import { PomodoroPage } from './PomodoroPage';
import { CalendarPage } from './CalendarPage';
import { ConnectorsPage } from './ConnectorsPage';
import { SettingsPage } from './SettingsPage';
import { Sidebar } from './Sidebar';
import { TranscriptionPage } from './TranscriptionPage';
import { AccountPage } from './AccountPage';
import { ToastProvider, useToast } from './Toast';
import { ConfirmProvider } from './ConfirmDialog';

export type View =
  | { kind: 'home' }
  | { kind: 'dictation' }
  | { kind: 'pomodoro' }
  | { kind: 'inbox' }
  | { kind: 'all' }
  | { kind: 'starred' }
  | { kind: 'folder'; id: string }
  | { kind: 'page'; id: string }
  | { kind: 'settings' }
  | { kind: 'transcription' }
  | { kind: 'account' }
  | { kind: 'connectors' }
  | { kind: 'calendar' };

const api = window.dashboardApi;

export function App() {
  const toast = useToast();
  const [view, setView] = useState<View>({ kind: 'home' });
  // Lives here so the search survives opening a page and coming Back; navigating elsewhere drops it.
  const [filter, setFilter] = useState<NoteFilter>(NO_FILTER);
  const navigate = (v: View) => {
    setView(v);
    setFilter(NO_FILTER);
  };
  const goHome = useCallback(() => setView({ kind: 'home' }), []);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  // Where Back from a page goes, and the page just created (its title starts selected).
  const [backTo, setBackTo] = useState<
    Exclude<View, { kind: 'page' } | { kind: 'settings' } | { kind: 'transcription' } | { kind: 'dictation' } | { kind: 'pomodoro' } | { kind: 'account' } | { kind: 'connectors' } | { kind: 'calendar' }>
  >({ kind: 'inbox' });
  const [freshPageId, setFreshPageId] = useState<string | null>(null);

  const loadNotes = useCallback(() => api.listNotes().then(setNotes), []);
  const loadPages = useCallback(() => api.listPages().then(setPages), []);
  const loadFolders = useCallback(() => api.listFolders().then(setFolders), []);

  useEffect(() => {
    loadNotes();
    loadPages();
    loadFolders();
    const offNotes = api.onNotesChanged(loadNotes);
    const offPages = api.onPagesChanged(loadPages);
    const offFolders = api.onFoldersChanged(loadFolders);
    return () => {
      offNotes();
      offPages();
      offFolders();
    };
  }, [loadNotes, loadPages, loadFolders]);

  // The folder or page being viewed was deleted (here or elsewhere): fall back to Inbox.
  useEffect(() => {
    if (view.kind === 'folder' && !folders.some((f) => f.id === view.id)) navigate({ kind: 'inbox' });
    if (view.kind === 'page' && pages && !pages.some((p) => p.id === view.id)) navigate({ kind: 'inbox' });
  }, [folders, pages, view]);

  const openPage = (id: string, fresh = false) => {
    if (view.kind !== 'page' && view.kind !== 'settings' && view.kind !== 'transcription' && view.kind !== 'dictation' && view.kind !== 'pomodoro' && view.kind !== 'account' && view.kind !== 'connectors' && view.kind !== 'calendar')
      setBackTo(view);
    setFreshPageId(fresh ? id : null);
    setView({ kind: 'page', id });
  };

  const newPage = (folderId: string | null) =>
    api
      .createPage(folderId)
      .then((page) => {
        // Known before the PagesChanged reload lands, so the fallback above doesn't bounce the new page.
        setPages((prev) => [page, ...(prev ?? []).filter((p) => p.id !== page.id)]);
        setFilter(NO_FILTER);
        openPage(page.id, true);
      })
      .catch((e) => toast(cleanIpcError(e)));

  const inInbox = (x: { folderId: string | null }) => x.folderId === null;
  const isStarred = (x: { starred: boolean }) => x.starred;
  const counts = {
    inbox: (notes?.filter(inInbox).length ?? 0) + (pages?.filter(inInbox).length ?? 0),
    all: (notes?.length ?? 0) + (pages?.length ?? 0),
    starred: (notes?.filter(isStarred).length ?? 0) + (pages?.filter(isStarred).length ?? 0),
  };

  return (
    <ToastProvider>
      <ConfirmProvider>
      <div className="flex h-screen flex-col bg-background text-foreground antialiased">
        {/* Draggable strip replacing the native title bar; caption buttons are drawn over its right end. */}
        <div className="app-drag flex h-10 shrink-0">
          <div className="flex w-60 items-center gap-2 border-r border-sidebar-border bg-sidebar px-5">
            <Logo className="h-4 w-auto" />
            <span className="font-display text-[14px] font-semibold tracking-tight">Voice Notes</span>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <Sidebar view={view} onSelect={navigate} folders={folders} counts={counts} onNewPage={newPage} />
          <main className="flex-1 overflow-y-auto">
            {view.kind === 'home' ? (
              <HomePage pages={pages} onOpenPage={openPage} onOpenConnectors={() => navigate({ kind: 'connectors' })} />
            ) : view.kind === 'dictation' ? (
              <DictationPage />
            ) : view.kind === 'pomodoro' ? (
              <PomodoroPage />
            ) : view.kind === 'settings' ? (
              <SettingsPage />
            ) : view.kind === 'transcription' ? (
              <TranscriptionPage />
            ) : view.kind === 'connectors' ? (
              <ConnectorsPage />
            ) : view.kind === 'calendar' ? (
              <CalendarPage onOpenConnectors={() => navigate({ kind: 'connectors' })} />
            ) : view.kind === 'account' ? (
              <AccountPage onSignedOut={goHome} />
            ) : view.kind === 'page' ? (
              <PageView
                key={view.id}
                page={pages?.find((p) => p.id === view.id)}
                fresh={freshPageId === view.id}
                onBack={() => setView(backTo)}
              />
            ) : (
              <NotesPage
                view={view}
                filter={filter}
                setFilter={setFilter}
                notes={notes}
                pages={pages}
                folders={folders}
                onNavigate={navigate}
                onOpenPage={openPage}
                onNewPage={newPage}
              />
            )}
          </main>
        </div>
      </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
