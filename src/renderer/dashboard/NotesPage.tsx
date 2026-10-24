import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note } from '../../shared/channels';
import { groupByDay } from '../../shared/format';
import { NoteRow } from './NoteRow';

const api = window.dashboardApi;

export function NotesPage() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [hotkeyLabel, setHotkeyLabel] = useState('your hotkey');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  const load = useCallback(() => {
    api.listNotes().then(setNotes);
    api.getSettings().then((s) => setHotkeyLabel(s.hotkeyLabel));
  }, []);

  useEffect(() => {
    load();
    const offNotes = api.onNotesChanged(load);
    const offSettings = api.onSettingsChanged(load);
    return () => {
      offNotes();
      offSettings();
    };
  }, [load]);

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

  const remove = async (note: Note) => {
    if (!confirm('Delete this note?')) return;
    if (playingId === note.id) {
      audio.current?.pause();
      setPlayingId(null);
    }
    await api.deleteNote(note.id);
  };

  return (
    <div className="mx-auto max-w-3xl px-10 py-9">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <p className="mt-1 text-sm text-stone-500">
          Hold <Kbd>{hotkeyLabel}</Kbd> anywhere to record. Double-tap for hands-free.
        </p>
      </header>

      <audio
        ref={audio}
        onTimeUpdate={(e) => setPositionMs(e.currentTarget.currentTime * 1000)}
        onEnded={() => setPlayingId(null)}
        onError={() => setPlayingId(null)}
      />

      {notes === null ? null : notes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-8 py-14 text-center">
          <p className="text-[15px] font-medium">No notes yet</p>
          <p className="mt-1 text-sm text-stone-500">
            Hold <Kbd>{hotkeyLabel}</Kbd> anywhere to record your first phrase.
          </p>
        </div>
      ) : (
        groupByDay(notes, Date.now()).map((group) => (
          <section key={group.label} className="mb-8">
            <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-stone-500">{group.label}</h2>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {group.notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  playing={playingId === note.id}
                  positionMs={playingId === note.id ? positionMs : 0}
                  onTogglePlay={() => togglePlay(note)}
                  onRename={(title) => api.renameNote(note.id, title)}
                  onReveal={() => api.revealNote(note.id)}
                  onDelete={() => remove(note)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-stone-300 bg-white px-1.5 py-0.5 font-sans text-xs font-medium text-stone-700 shadow-[0_1px_0_0_rgb(0_0_0/0.06)]">
      {children}
    </kbd>
  );
}
