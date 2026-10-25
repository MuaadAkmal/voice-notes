import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import type { Folder, Note } from '../../shared/channels';
import { distinctShows, filterNotes, isFiltering, NO_FILTER, type NoteFilter, type SourceFilter } from '../../shared/search';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { folderPath, selectRange } from '../../shared/folders';
import { cleanIpcError, groupByDay } from '../../shared/format';
import type { View } from './App';
import { NOTES_MIME, onDropped, setCountDragImage, setDragging } from './dnd';
import { NoteRow } from './NoteRow';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';

const api = window.dashboardApi;

type NotesView = Exclude<View, { kind: 'settings' }>;
type Props = { view: NotesView; navSeq: number; notes: Note[] | null; folders: Folder[]; onNavigate: (v: View) => void };

const viewKey = (v: NotesView) => (v.kind === 'folder' ? v.id : v.kind);
// Radix Select can't hold an empty value; this stands for "no filter".
const ANY = '__any';
const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: 'mic', label: 'Microphone' },
  { value: 'system', label: 'System audio' },
  { value: 'both', label: 'Mic + system' },
  { value: 'rewind', label: 'Rewinds' },
];

export function NotesPage({ view, navSeq, notes, folders, onNavigate }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [hotkeyLabel, setHotkeyLabel] = useState('your hotkey');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<NoteFilter>(NO_FILTER);
  const anchor = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const filtering = isFiltering(filter);
  const shows = useMemo(() => distinctShows(notes ?? []), [notes]);

  useEffect(() => {
    const load = () => api.getSettings().then((s) => setHotkeyLabel(s.hotkeyLabel));
    load();
    return api.onSettingsChanged(load);
  }, []);

  // Any search or filter looks across every folder.
  const visible = useMemo(() => {
    if (!notes) return null;
    if (filtering) return filterNotes(notes, filter);
    if (view.kind === 'starred') return notes.filter((n) => n.starred);
    if (view.kind === 'inbox') return notes.filter((n) => n.folderId === null);
    if (view.kind === 'folder') return notes.filter((n) => n.folderId === view.id);
    return notes;
  }, [notes, view, filter, filtering]);

  const clearSelection = () => {
    setSelected(new Set());
    anchor.current = null;
  };

  // Selection belongs to one view; drop it on navigation and after a successful drag-move.
  useEffect(clearSelection, [viewKey(view)]);
  // Navigating somewhere is a new question: drop the search.
  useEffect(() => setFilter(NO_FILTER), [viewKey(view), navSeq]);
  // The chosen show vanished (its last note was renamed or deleted): stop filtering on it.
  useEffect(() => {
    if (filter.show !== null && !shows.some((s) => s.show === filter.show)) setFilter((f) => ({ ...f, show: null }));
  }, [shows, filter.show]);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
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
  const title = filtering
    ? 'Search'
    : view.kind === 'inbox'
      ? 'Inbox'
      : view.kind === 'all'
        ? 'All notes'
        : view.kind === 'starred'
          ? 'Starred'
          : (path.at(-1)?.name ?? '');
  const showFolders = filtering || view.kind === 'all' || view.kind === 'starred';
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
        {filtering ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {visible?.length ?? 0} {visible?.length === 1 ? 'note' : 'notes'} across all folders
          </p>
        ) : (
          (view.kind === 'inbox' || view.kind === 'all') && (
            <p className="mt-1 text-sm text-muted-foreground">
              Hold <Kbd>{hotkeyLabel}</Kbd> anywhere to record. New notes land in Inbox.
            </p>
          )
        )}
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchInput}
            type="search"
            aria-label="Search notes"
            placeholder="Search titles and shows…"
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filter.query) {
                e.stopPropagation();
                setFilter((f) => ({ ...f, query: '' }));
              }
            }}
            className="h-9 w-full rounded-md border border-input bg-transparent pr-3 pl-8 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>
        <Select
          value={filter.show ?? ANY}
          onValueChange={(v) => setFilter((f) => ({ ...f, show: v === ANY ? null : v }))}
          disabled={shows.length === 0 && filter.show === null}
        >
          <SelectTrigger className="w-40" aria-label="Filter by show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All shows</SelectItem>
            {shows.map(({ show, count }) => (
              <SelectItem key={show} value={show}>
                {show} <span className="text-muted-foreground">{count}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filter.source ?? ANY}
          onValueChange={(v) => setFilter((f) => ({ ...f, source: v === ANY ? null : (v as SourceFilter) }))}
        >
          <SelectTrigger className="w-34" aria-label="Filter by source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any source</SelectItem>
            {SOURCE_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          aria-label="Starred only"
          aria-pressed={filter.starred}
          title="Starred only"
          onClick={() => setFilter((f) => ({ ...f, starred: !f.starred }))}
          className="grid h-9 w-9 place-items-center rounded-md border border-input text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground aria-pressed:border-amber-500/50 aria-pressed:bg-amber-500/10 aria-pressed:text-amber-500"
        >
          <Star className="size-4" fill={filter.starred ? 'currentColor' : 'none'} />
        </button>
        {filtering && (
          <button
            aria-label="Clear filters"
            title="Clear filters"
            onClick={() => setFilter(NO_FILTER)}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

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
        <EmptyState view={view} hotkeyLabel={hotkeyLabel} filtering={filtering} />
      ) : (
        groupByDay(visible, Date.now(), (n) => n.createdAt).map((group) => (
          <section key={group.label} className="mb-8">
            <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{group.label}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
              {group.items.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  selected={selected.has(note.id)}
                  folderLabel={showFolders ? labelFor(note) : undefined}
                  playing={playingId === note.id}
                  positionMs={playingId === note.id ? positionMs : 0}
                  onSelect={(e) => select(note, e)}
                  onDragStart={(e) => dragStart(note, e)}
                  onDragEnd={() => setDragging(null)}
                  onTogglePlay={() => togglePlay(note)}
                  onRename={(t) => api.renameNote(note.id, t).catch((e) => toast(cleanIpcError(e)))}
                  onReveal={() => api.revealNote(note.id)}
                  onDelete={() => remove([note.id])}
                  onToggleStar={() => api.starNotes([note.id], !note.starred).catch((e) => toast(cleanIpcError(e)))}
                  onSetShow={(show) => api.setShow(note.id, show).catch((e) => toast(cleanIpcError(e)))}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function EmptyState({ view, hotkeyLabel, filtering }: { view: NotesView; hotkeyLabel: string; filtering: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card px-8 py-14 text-center">
      {filtering ? (
        <>
          <p className="text-[15px] font-medium">No notes match</p>
          <p className="mt-1 text-sm text-muted-foreground">Try fewer words, or clear the filters.</p>
        </>
      ) : view.kind === 'starred' ? (
        <>
          <p className="text-[15px] font-medium">No starred notes</p>
          <p className="mt-1 text-sm text-muted-foreground">Star the phrases you want to come back to.</p>
        </>
      ) : view.kind === 'folder' ? (
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
