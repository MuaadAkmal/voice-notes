import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AudioLines, ChevronDown, Clapperboard, Copy, History, Loader2, MoreHorizontal, Star, Volume2 } from 'lucide-react';
import type { JobStatus, Note } from '../../shared/channels';
import { formatDuration, isDefaultTitle } from '../../shared/format';
import { matchRanges } from '../../shared/search';
import { TRANSCRIBE_LANGUAGES, type TranscribeLanguage } from '../../shared/transcription';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from './Toast';

type Props = {
  note: Note;
  selected: boolean;
  folderLabel?: string; // shown in "All notes"
  onSelect: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  playing: boolean;
  positionMs: number;
  onTogglePlay: () => void;
  onRename: (title: string) => void;
  onReveal: () => void;
  onDelete: () => void;
  onToggleStar: () => void;
  onSetShow: (show: string | null) => void;
  transcription?: JobStatus;
  transcriptionReady: boolean; // a server is set up
  transcribeLanguage: TranscribeLanguage;
  onTranscribe: (language?: TranscribeLanguage) => void;
  onRetranscribe: () => void;
  onSetupTranscription: () => void;
  onEditTranscript: (text: string) => void;
  query?: string; // the search, highlighted in the transcript
};

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function NoteRow(props: Props) {
  const { note, selected, folderLabel, onSelect, onDragStart, onDragEnd } = props;
  const { playing, positionMs, onTogglePlay, onRename, onReveal, onDelete, onToggleStar, onSetShow } = props;
  const { transcription, transcriptionReady, onTranscribe, onRetranscribe, onSetupTranscription } = props;
  const [editing, setEditing] = useState(false);
  const [editingShow, setEditingShow] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const toast = useToast();
  // With a transcript, the untouched "Voice note · HH:MM" title only repeats the time column: the text leads.
  const textFirst = !!note.transcript && isDefaultTitle(note.title) && !editing;
  // A queued or running job hides the Transcribe actions; a failed one shows Retry instead.
  const busy = transcription !== undefined && transcription.state !== 'failed';
  const canTranscribe = !busy && note.status === 'ok';
  const editFromMenu = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const showInput = useRef<HTMLInputElement>(null);
  const missing = note.status === 'missing';
  // MediaRecorder WebM has no duration header (<audio>.duration is Infinity), so progress uses the stored length.
  const progress = note.durationMs > 0 ? Math.min(1, Math.max(0, positionMs / note.durationMs)) : 0;

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  useEffect(() => {
    if (editingShow) showInput.current?.select();
  }, [editingShow]);

  const commitShow = (value: string) => {
    setEditingShow(false);
    const show = value.trim();
    if (show !== (note.show ?? '')) onSetShow(show || null);
  };

  const commit = (value: string) => {
    setEditing(false);
    const title = value.trim();
    if (title && title !== note.title) onRename(title);
  };

  const transcript = (
    <Transcript
      note={note}
      editing={editingTranscript}
      setEditing={setEditingTranscript}
      onSave={props.onEditTranscript}
      query={props.query ?? ''}
      first={textFirst}
    />
  );

  return (
    <li
      draggable={!editing && !editingShow && !editingTranscript}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        // Ignore the row's own controls, and portal content (menus) whose React events bubble here.
        if (!e.currentTarget.contains(target) || target.closest('button, input, textarea')) return;
        onSelect(e);
      }}
      aria-selected={selected}
      className={`group relative flex cursor-default select-none items-center gap-4 px-4 py-3 transition-colors ${
        selected ? 'bg-accent shadow-[inset_3px_0_0_0_var(--foreground)]' : 'hover:bg-accent/50'
      } ${missing ? 'opacity-50' : ''}`}
    >
      <button
        onClick={onTogglePlay}
        disabled={missing}
        aria-label={playing ? 'Pause' : 'Play'}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 h-3.5 w-3.5" fill="currentColor">
            <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={input}
            defaultValue={note.title}
            maxLength={200}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value);
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full rounded-md border border-input bg-background px-2 py-0.5 text-sm outline-none focus:border-ring"
          />
        ) : textFirst ? null : (
          <button
            onClick={() => setEditing(true)}
            title="Click to rename"
            className="block max-w-full truncate text-left text-sm font-medium hover:underline hover:decoration-muted-foreground/40"
          >
            {note.title}
          </button>
        )}
        {textFirst && transcript}
        <div className={`${textFirst ? 'mt-2' : 'mt-1.5'} flex items-center gap-3`}>
          {note.transcriptLang && (
            <span
              title={`Transcript language: ${LANGUAGE_NAMES[note.transcriptLang] ?? note.transcriptLang}`}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground"
            >
              {note.transcriptLang}
            </span>
          )}
          {note.kind === 'rewind' && (
            <span
              title="Rewind: the last seconds of system audio, saved in film mode"
              className="flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-700 dark:text-sky-300"
            >
              <History className="size-3" />
              Rewind
            </span>
          )}
          {editingShow ? (
            <input
              ref={showInput}
              aria-label="Show"
              defaultValue={note.show ?? ''}
              placeholder="Show or film"
              maxLength={120}
              onBlur={(e) => commitShow(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitShow(e.currentTarget.value);
                if (e.key === 'Escape') setEditingShow(false);
              }}
              className="w-48 rounded border border-input bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-ring"
            />
          ) : (
            note.show && (
              <button
                onClick={() => setEditingShow(true)}
                title={note.windowTitle ? `Recorded over: ${note.windowTitle}\nClick to edit` : 'Click to edit'}
                className="flex max-w-48 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Clapperboard className="size-3 shrink-0" />
                <span className="truncate">{note.show}</span>
              </button>
            )
          )}
          {note.source !== 'mic' && note.kind !== 'rewind' && (
            <span title={note.source === 'both' ? 'Mic + system audio' : 'System audio'} className="text-muted-foreground">
              <Volume2 className="size-3.5" aria-label="Includes system audio" />
            </span>
          )}
          {folderLabel && (
            <span className="max-w-48 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {folderLabel}
            </span>
          )}
          {missing ? (
            <span className="text-xs text-destructive">File missing</span>
          ) : (
            note.durationMs > 0 && (
              <div className="h-1 w-40 min-w-12 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />
              </div>
            )
          )}
        </div>
        {!textFirst && transcript}
        {transcription && <JobLine status={transcription} onRetry={() => onTranscribe()} />}
      </div>

      {note.transcript === null && canTranscribe && (
        <TranscribeButton
          ready={transcriptionReady}
          language={props.transcribeLanguage}
          onTranscribe={onTranscribe}
          onSetup={onSetupTranscription}
        />
      )}

      {/* Copy and Star appear over the duration and time on hover, so the text keeps their room. */}
      <div className="relative flex items-center gap-4">
        <div className="flex items-center gap-4 transition-opacity group-hover:opacity-0 group-has-[:focus-visible]:opacity-0">
          {note.starred && <Star aria-hidden className="size-3.5 text-amber-500" fill="currentColor" />}
          <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatDuration(note.durationMs)}</span>
          <span className="w-12 text-right text-xs tabular-nums text-muted-foreground/70">{timeOf(note.createdAt)}</span>
        </div>
        <div className="absolute inset-y-0 right-0 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {!!note.transcript && !editingTranscript && (
            <button
              aria-label="Copy transcript"
              title="Copy transcript"
              onClick={() =>
                navigator.clipboard
                  .writeText(note.transcript ?? '')
                  .then(() => toast('Transcript copied'))
                  .catch(() => toast("Couldn't copy"))
              }
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Copy className="size-4" />
            </button>
          )}
          <button
            aria-label={note.starred ? 'Unstar' : 'Star'}
            aria-pressed={note.starred}
            onClick={onToggleStar}
            className={`grid h-8 w-8 place-items-center rounded-md hover:bg-accent ${
              note.starred ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Star className="size-4" fill={note.starred ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="More"
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44"
          // Returning focus to the trigger would immediately blur (and commit) the rename input.
          onCloseAutoFocus={(e) => {
            if (editFromMenu.current) {
              e.preventDefault();
              editFromMenu.current = false;
            }
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              editFromMenu.current = true;
              setEditing(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              editFromMenu.current = true;
              setEditingShow(true);
            }}
          >
            {note.show ? 'Edit show' : 'Add show'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleStar}>{note.starred ? 'Unstar' : 'Star'}</DropdownMenuItem>
          {canTranscribe &&
            (transcriptionReady ? (
              <DropdownMenuItem onSelect={note.transcript === null ? () => onTranscribe() : onRetranscribe}>
                {note.transcript === null ? 'Transcribe' : 'Re-transcribe'}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onSetupTranscription}>Set up transcription</DropdownMenuItem>
            ))}
          {!missing && <DropdownMenuItem onSelect={onReveal}>Show in folder</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function Transcript(props: {
  note: Note;
  editing: boolean;
  setEditing: (on: boolean) => void;
  onSave: (text: string) => void;
  query: string;
  first: boolean; // leads the row (no title above)
}) {
  const { note, editing, setEditing, onSave, query, first } = props;
  const cancelled = useRef(false);
  if (note.transcript === null) return null;
  if (editing) {
    return (
      <textarea
        aria-label="Transcript"
        autoFocus
        defaultValue={note.transcript}
        maxLength={100_000}
        onBlur={(e) => {
          setEditing(false);
          if (cancelled.current) cancelled.current = false;
          else if (e.currentTarget.value !== note.transcript) onSave(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          cancelled.current = true;
          e.currentTarget.blur();
        }}
        className={`${first ? '' : 'mt-2'} block w-full resize-none rounded-md border border-input bg-background px-2 py-1 text-xs leading-relaxed outline-none [field-sizing:content] focus:border-ring`}
      />
    );
  }
  if (note.transcript === '') return <div className="mt-2 text-xs italic text-muted-foreground">No speech detected</div>;
  return <TranscriptText text={note.transcript} query={query} first={first} onEdit={() => setEditing(true)} />;
}

const CLAMP_LINES = 4;

function highlight(text: string, ranges: [number, number][]) {
  if (ranges.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-amber-200/70 text-inherit dark:bg-amber-400/30">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return parts;
}

/** The transcript as the row's body, like a message: full-colour text, clamped with Show more when long. */
function TranscriptText(props: { text: string; query: string; first: boolean; onEdit: () => void }) {
  const { text, query, first, onEdit } = props;
  const body = useRef<HTMLSpanElement>(null);
  const ranges = matchRanges(text, query);
  // A search opens the transcript, so a match past the fourth line is still visible.
  const [expanded, setExpanded] = useState(ranges.length > 0);
  const matched = ranges.length > 0;
  useEffect(() => setExpanded(matched), [matched]);
  const [overflows, setOverflows] = useState(false);

  // Longer than CLAMP_LINES lines, measured from the full height so it holds whether or not it's clamped.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => {
      const line = parseFloat(getComputedStyle(el).lineHeight);
      setOverflows(el.scrollHeight > line * CLAMP_LINES + 1);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    return () => resize.disconnect();
  }, [text]);

  return (
    <div className={first ? '' : 'mt-2.5'}>
      <button
        aria-label="Show transcript"
        title="Click to edit"
        onClick={onEdit}
        className="block w-full cursor-text text-left text-sm leading-relaxed text-foreground/90"
      >
        <span
          ref={body}
          className="block whitespace-pre-line"
          style={expanded ? undefined : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: CLAMP_LINES, overflow: 'hidden' }}
        >
          {highlight(text, ranges)}
        </span>
      </button>
      {overflows && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function JobLine({ status, onRetry }: { status: JobStatus; onRetry: () => void }) {
  if (status.state === 'queued') return <div className="mt-1.5 text-xs text-muted-foreground">Queued</div>;
  if (status.state === 'running')
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Transcribing…
      </div>
    );
  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs">
      <span className="text-destructive" title={status.error}>
        Failed
      </span>
      <button onClick={onRetry} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        Retry
      </button>
    </div>
  );
}

const LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(TRANSCRIBE_LANGUAGES.map((l) => [l.code, l.name]));

/** Transcribe now with the last language, or pick another from the arrow. Shown on hover, like the star. */
function TranscribeButton(props: {
  ready: boolean;
  language: TranscribeLanguage;
  onTranscribe: (language?: TranscribeLanguage) => void;
  onSetup: () => void;
}) {
  const { ready, language, onTranscribe, onSetup } = props;
  const reveal =
    'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100';
  if (!ready) {
    return (
      // Icon only: a wide invisible target would swallow clicks meant to select the row.
      <button
        aria-label="Set up transcription"
        title="Set up transcription"
        onClick={onSetup}
        className={`${reveal} grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground`}
      >
        <AudioLines className="size-4" />
      </button>
    );
  }
  return (
    <div className={`${reveal} flex h-8 items-center rounded-md border text-xs text-muted-foreground`}>
      <button
        aria-label="Transcribe"
        title={language === 'auto' ? 'Transcribe (auto-detect language)' : `Transcribe (${LANGUAGE_NAMES[language]})`}
        onClick={() => onTranscribe()}
        className="flex h-full items-center gap-1.5 rounded-l-md px-2 hover:bg-accent hover:text-foreground"
      >
        <AudioLines className="size-3.5" />
        Transcribe
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Transcription language"
            className="grid h-full place-items-center rounded-r-md border-l px-1 hover:bg-accent hover:text-foreground"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-44 overflow-y-auto">
          {[{ code: 'auto' as const, name: 'Auto-detect' }, ...TRANSCRIBE_LANGUAGES].map((l) => (
            <DropdownMenuCheckboxItem
              key={l.code}
              checked={language === l.code}
              onSelect={() => onTranscribe(l.code)}
            >
              {l.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
