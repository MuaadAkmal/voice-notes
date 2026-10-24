import { useCallback, useEffect, useState } from 'react';
import type { Folder, Note } from '../../shared/channels';
import { NotesPage } from './NotesPage';
import { SettingsPage } from './SettingsPage';
import { Sidebar } from './Sidebar';
import { ToastProvider } from './Toast';

export type View = { kind: 'inbox' } | { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'settings' };

const api = window.dashboardApi;

export function App() {
  const [view, setView] = useState<View>({ kind: 'inbox' });
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);

  const loadNotes = useCallback(() => api.listNotes().then(setNotes), []);
  const loadFolders = useCallback(() => api.listFolders().then(setFolders), []);

  useEffect(() => {
    loadNotes();
    loadFolders();
    const offNotes = api.onNotesChanged(loadNotes);
    const offFolders = api.onFoldersChanged(loadFolders);
    return () => {
      offNotes();
      offFolders();
    };
  }, [loadNotes, loadFolders]);

  // The folder being viewed was deleted (here or elsewhere): fall back to Inbox.
  useEffect(() => {
    if (view.kind === 'folder' && !folders.some((f) => f.id === view.id)) setView({ kind: 'inbox' });
  }, [folders, view]);

  const counts = {
    inbox: notes?.filter((n) => n.folderId === null).length ?? 0,
    all: notes?.length ?? 0,
  };

  return (
    <ToastProvider>
      <div className="flex h-screen flex-col bg-stone-50 text-stone-900 antialiased">
        {/* Draggable strip replacing the native title bar; caption buttons are drawn over its right end. */}
        <div className="app-drag flex h-10 shrink-0">
          <div className="flex w-60 items-center gap-2 border-r border-stone-200 bg-stone-100/70 px-5">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-stone-900">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            </span>
            <span className="text-[13px] font-semibold tracking-tight">Voice Notes</span>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <Sidebar view={view} onSelect={setView} folders={folders} counts={counts} />
          <main className="flex-1 overflow-y-auto">
            {view.kind === 'settings' ? (
              <SettingsPage />
            ) : (
              <NotesPage view={view} notes={notes} folders={folders} onNavigate={setView} />
            )}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
