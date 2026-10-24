import { useEffect, useMemo, useRef, useState } from 'react';
import type { Folder, Note } from '../../shared/channels';
import { folderPath, selectRange } from '../../shared/folders';
import { cleanIpcError, groupByDay } from '../../shared/format';
import type { View } from './App';
import { NOTES_MIME, onDropped, setCountDragImage, setDragging } from './dnd';
import { NoteRow } from './NoteRow';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';

const api = window.dashboardApi;

type NotesView = Exclude<View, { kind: 'settings' }>;
type Props = { view: NotesView; notes: Note[] | null; folders: Folder[]; onNavigate: (v: View) => void };

const viewKey = (v: NotesView) => (v.kind === 'folder' ? v.id : v.kind);

export function NotesPage({ view, notes, folders, onNavigate }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [hotkeyLabel, setHotkeyLabel] = useState('your hotkey');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const load = () => api.getSettings().then((s) => setHotkeyLabel(s.hotkeyLabel));
    load();
    return api.onSettingsChanged(load);
  }, []);

  const visible = useMemo(() => {
    if (!notes) return null;
    if (view.kind === 'inbox') return notes.filter((n) => n.folderId === null);
    if (view.kind === 'folder') return notes.filter((n) => n.folderId === view.id);
    return notes;
  }, [notes, view]);

  const clearSelection = () => {
    setSelected(new Set());
    anchor.current = null;
  };

  // Selection belongs to one view; drop it on navigation and after a successful drag-move.
  useEffect(clearSelection, [viewKey(view)]);
  useEffect(() => onDropped(clearSelection), []);
  // Notes that left this view (moved, deleted) leave the selection too.
  useEffect(() => {
    if (!visible) return;
    const ids = new Set(visible.map((n) => n.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // A playing note that left the view would have no row left to stop it from.
    if (playingId && !ids.has(playingId)) {
      audio.current?.pause();
      setPlayingId(null);
    }
  }, [visible, playingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && clearSelection();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const order = visible?.map((n) => n.id) ?? [];

  const select = (note: Note, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current) {
      setSelected(new Set(selectRange(order, anchor.current, note.id)));
      return;
    }
    anchor.current = note.id;
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(note.id)) next.delete(note.id);
        else next.add(note.id);
        return next;
      });
    } else {
      setSelected(new Set([note.id]));
    }
  };

  const dragStart = (note: Note, e: React.DragEvent) => {
    const ids = selected.has(note.id) ? order.filter((id) => selected.has(id)) : [note.id];
    setDragging({ kind: 'notes', ids });
    e.dataTransfer.setData(NOTES_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
    setCountDragImage(e, ids.length);
  };

  const stopIfPlaying = (ids: string[]) => {
    if (playingId && ids.includes(playingId)) {
      audio.current?.pause();
      setPlayingId(null);
    }
  };

  // One shared <audio>: starting a note stops whatever was playing.
  const togglePlay = (note: Note) => {
    const el = audio.current;
    if (!el) return;
    if (playingId === note.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = `note://${note.id}`;
    setPositionMs(0);
    setPlayingId(note.id);
    el.play().catch(() => setPlayingId(null));
  };

  const remove = async (ids: string[]) => {
    const ok = await confirm({ title: ids.length === 1 ? 'Delete this note?' : `Delete ${ids.length} notes?` });
    if (!ok) return;
    stopIfPlaying(ids);
    try {
      await (ids.length === 1 ? api.deleteNote(ids[0]) : api.deleteNotes(ids));
    } catch (e) {
      toast(cleanIpcError(e));
    }
  };

  const path = view.kind === 'folder' ? folderPath(view.id, folders) : [];
  const title = view.kind === 'inbox' ? 'Inbox' : view.kind === 'all' ? 'All notes' : (path.at(-1)?.name ?? '');
  const labelFor = (n: Note) => folderPath(n.folderId, folders).map((f) => f.name).join(' › ') || 'Inbox';

  return (
    <div
      className="mx-auto min-h-full max-w-3xl px-10 py-8"
      onClick={(e) => e.target === e.currentTarget && clearSelection()}
    >
      <header className="mb-7">
        {path.length > 1 && (
          <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {path.slice(0, -1).map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <button className="hover:text-foreground hover:underline" onClick={() => onNavigate({ kind: 'folder', id: f.id })}>
                  {f.name}
                </button>
                <span>›</span>
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {view.kind !== 'folder' && (
          <p className="mt-1 text-sm text-muted-foreground">
            Hold <Kbd>{hotkeyLabel}</Kbd> anywhere to record. New notes land in Inbox.
          </p>
        )}
      </header>

      <audio
        ref={audio}
        onTimeUpdate={(e) => setPositionMs(e.currentTarget.currentTime * 1000)}
        onEnded={() => setPlayingId(null)}
        onError={() => setPlayingId(null)}
      />

      {selected.size > 0 && (
        <div className="sticky top-3 z-10 mb-4 flex items-center gap-3 rounded-xl border bg-card/95 px-4 py-2 text-sm shadow-sm backdrop-blur">
          <span className="font-medium">{selected.size} selected</span>
          <span className="text-muted-foreground/70">Drag onto a folder to move</span>
          <span className="flex-1" />
          <button className="rounded-md px-2 py-1 text-destructive hover:bg-destructive/10" onClick={() => remove(order.filter((id) => selected.has(id)))}>
            Delete
          </button>
          <button className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent" onClick={clearSelection}>
            Clear
          </button>
        </div>
      )}

      {visible === null ? null : visible.length === 0 ? (
        <EmptyState view={view} hotkeyLabel={hotkeyLabel} />
      ) : (
        groupByDay(visible, Date.now()).map((group) => (
          <section key={group.label} className="mb-8">
            <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{group.label}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
              {group.notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  selected={selected.has(note.id)}
                  folderLabel={view.kind === 'all' ? labelFor(note) : undefined}
                  playing={playingId === note.id}
                  positionMs={playingId === note.id ? positionMs : 0}
                  onSelect={(e) => select(note, e)}
                  onDragStart={(e) => dragStart(note, e)}
                  onDragEnd={() => setDragging(null)}
                  onTogglePlay={() => togglePlay(note)}
                  onRename={(t) => api.renameNote(note.id, t).catch((e) => toast(cleanIpcError(e)))}
                  onReveal={() => api.revealNote(note.id)}
                  onDelete={() => remove([note.id])}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function EmptyState({ view, hotkeyLabel }: { view: NotesView; hotkeyLabel: string }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card px-8 py-14 text-center">
      {view.kind === 'folder' ? (
        <>
          <p className="text-[15px] font-medium">No notes here</p>
          <p className="mt-1 text-sm text-muted-foreground">Drag notes onto this folder in the sidebar.</p>
        </>
      ) : (
        <>
          <p className="text-[15px] font-medium">No notes yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Hold <Kbd>{hotkeyLabel}</Kbd> anywhere to record your first phrase.
          </p>
        </>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-background px-1.5 py-0.5 font-sans text-xs font-medium text-foreground/80 shadow-[0_1px_0_0_rgb(0_0_0/0.06)]">
      {children}
    </kbd>
  );
}
