import { Prec, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { Note } from '../../../shared/channels';
import { audioLine, audioNoteId, slashAudio } from '../../../shared/audio-blocks';
import { formatDuration } from '../../../shared/format';

// Voice blocks in a page: `/audio` opens a recorder right there; a saved recording becomes the line
// `[🎙 Voice note](note://<id>)`, shown as a player with its transcript. The page owns the note
// (main keeps it out of the note lists and removes it once no page links to it).

const api = window.dashboardApi;
const MAX_MS = 300_000;
const MIME = 'audio/webm;codecs=opus';

const openRecorder = StateEffect.define<number>();
const closeRecorder = StateEffect.define<null>();

/** Where an open recorder sits (mapped through edits), or null. */
const recorderAt = StateField.define<number | null>({
  create: () => null,
  update(pos, tr) {
    for (const e of tr.effects) {
      if (e.is(openRecorder)) return e.value;
      if (e.is(closeRecorder)) return null;
    }
    return pos === null ? null : tr.changes.mapPos(pos);
  },
});

function decorations(state: EditorState, pageId: string | null, onError: (m: string) => void): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const sel = state.selection.main;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const id = audioNoteId(line.text);
    // The cursor on the line shows its markdown, as for images and tables.
    if (!id || (sel.from <= line.to && sel.to >= line.from)) continue;
    ranges.push(Decoration.replace({ block: true, widget: new PlayerWidget(id) }).range(line.from, line.to));
  }
  const at = state.field(recorderAt, false);
  if (at != null && pageId)
    ranges.push(Decoration.widget({ block: true, side: -1, widget: new RecorderWidget(pageId, onError) }).range(state.doc.lineAt(at).from));
  return Decoration.set(ranges, true);
}

/** Enter or Space right after `/audio` (not in code) opens the recorder in its place. */
const slashCommand = (enabled: () => boolean) => {
  const run = (view: EditorView) => {
    const { state } = view;
    const range = state.selection.main;
    if (!enabled() || state.readOnly || !range.empty || state.field(recorderAt) !== null) return false;
    const line = state.doc.lineAt(range.head);
    if (!slashAudio(line.text, range.head - line.from)) return false;
    for (let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(range.head, -1); node; node = node.parent)
      if (/Code/.test(node.name)) return false;
    const from = range.head - '/audio'.length;
    view.dispatch({ changes: { from, to: range.head }, effects: openRecorder.of(from), userEvent: 'input' });
    return true;
  };
  return Prec.highest(
    keymap.of([
      { key: 'Enter', run },
      { key: 'Space', run },
      { key: 'Escape', run: (view) => (view.state.field(recorderAt) === null ? false : (view.dispatch({ effects: closeRecorder.of(null) }), true)) },
    ]),
  );
};

/** Puts the saved block's line where the recorder was, on a line of its own. */
function insertBlock(view: EditorView, id: string): void {
  const at = view.state.field(recorderAt);
  if (at === null) return;
  const line = view.state.doc.lineAt(at);
  // The block goes on a line of its own (an empty line is replaced), and the cursor ends up after it,
  // so it shows as a player straight away: a line under the cursor shows its markdown.
  const blank = line.text.trim() === '';
  const insert = `${audioLine(id)}\n`;
  const rest = blank ? 0 : line.to - line.from;
  view.dispatch({
    changes: { from: line.from, to: blank ? line.to : line.from, insert },
    selection: { anchor: line.from + insert.length + rest },
    effects: closeRecorder.of(null),
    userEvent: 'input',
  });
}

const button = (label: string, cls: string) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `cm-vb-btn ${cls}`;
  b.textContent = label;
  return b;
};

class RecorderWidget extends WidgetType {
  private stop: (() => void) | null = null;
  private discard = true;

  constructor(
    readonly pageId: string,
    readonly onError: (m: string) => void,
  ) {
    super();
  }

  eq(other: RecorderWidget) {
    return other.pageId === this.pageId; // one recorder at a time: keep its DOM (and recording)
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-vb cm-vb-recorder';
    wrap.setAttribute('aria-label', 'Voice block recorder');
    const rec = button('● Record', 'cm-vb-rec');
    const time = document.createElement('span');
    time.className = 'cm-vb-time';
    time.textContent = '0:00';
    const close = button('×', 'cm-vb-close');
    close.setAttribute('aria-label', 'Cancel voice block');
    const status = document.createElement('span');
    status.className = 'cm-vb-status';
    wrap.append(rec, time, status, close);

    close.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ effects: closeRecorder.of(null) });
    });
    rec.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this.stop) {
        this.discard = false;
        this.stop();
        return;
      }
      void this.record(view, rec, time, status);
    });
    return wrap;
  }

  private async record(view: EditorView, rec: HTMLButtonElement, time: HTMLElement, status: HTMLElement) {
    let stream: MediaStream;
    try {
      const { micDeviceId } = await api.getSettings();
      stream = await navigator.mediaDevices.getUserMedia({ audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true });
    } catch {
      status.textContent = "Couldn't open the mic";
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType: MIME });
    const chunks: Blob[] = [];
    const started = Date.now();
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const tick = setInterval(() => {
      const ms = Date.now() - started;
      time.textContent = formatDuration(ms);
      if (ms >= MAX_MS) {
        this.discard = false;
        this.stop?.();
      }
    }, 250);
    recorder.onstop = async () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      this.stop = null;
      if (this.discard) return;
      rec.disabled = true;
      status.textContent = 'Saving…';
      try {
        const bytes = new Uint8Array(await new Blob(chunks, { type: MIME }).arrayBuffer());
        const id = await api.saveAudioBlock({ pageId: this.pageId, bytes, durationMs: Date.now() - started, mimeType: MIME });
        insertBlock(view, id);
      } catch {
        status.textContent = "Couldn't save it";
        this.onError("Couldn't save the voice block");
        rec.disabled = false;
      }
    };
    this.stop = () => recorder.state !== 'inactive' && recorder.stop();
    recorder.start(1000);
    rec.textContent = '■ Stop';
    rec.classList.add('cm-vb-recording');
  }

  /** Cancelled or the page closed: a recording in progress is dropped and the mic released. */
  destroy() {
    this.discard = true;
    this.stop?.();
  }

  ignoreEvent() {
    return true;
  }
}

class PlayerWidget extends WidgetType {
  private cleanup: (() => void) | null = null;

  constructor(readonly noteId: string) {
    super();
  }

  eq(other: PlayerWidget) {
    return other.noteId === this.noteId;
  }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-vb cm-vb-player';
    wrap.setAttribute('aria-label', 'Voice block');
    const play = button('▶', 'cm-vb-play');
    play.setAttribute('aria-label', 'Play voice block');
    const time = document.createElement('span');
    time.className = 'cm-vb-time';
    const text = document.createElement('div');
    text.className = 'cm-vb-transcript';
    const row = document.createElement('div');
    row.className = 'cm-vb-row';
    row.append(play, time);
    wrap.append(row, text);

    const audio = new Audio(`note://${this.noteId}`);
    audio.preload = 'none';
    audio.addEventListener('play', () => (play.textContent = '❚❚'));
    audio.addEventListener('pause', () => (play.textContent = '▶'));
    audio.addEventListener('ended', () => (play.textContent = '▶'));
    play.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (audio.paused) void audio.play().catch(() => (text.textContent = 'This recording is not available'));
      else audio.pause();
    });

    const show = (n: Note | null) => {
      if (!n) {
        time.textContent = '';
        text.textContent = 'Voice note not found';
        return;
      }
      time.textContent = formatDuration(n.durationMs);
      text.textContent = n.transcript === null ? 'Transcribing…' : n.transcript || 'No speech';
      text.classList.toggle('cm-vb-dim', !n.transcript);
    };
    const load = () => void api.getNote(this.noteId).then(show, () => show(null));
    load();
    const off = api.onNotesChanged(load);
    this.cleanup = () => {
      off();
      audio.pause();
    };
    return wrap;
  }

  destroy() {
    this.cleanup?.();
  }

  ignoreEvent() {
    return true;
  }
}

const theme = EditorView.baseTheme({
  '.cm-vb': {
    margin: '4px 0',
    padding: '8px 12px',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    background: 'color-mix(in oklab, var(--muted) 60%, transparent)',
    fontFamily: 'inherit',
  },
  '.cm-vb-recorder, .cm-vb-row': { display: 'flex', alignItems: 'center', gap: '10px' },
  '.cm-vb-btn': {
    cursor: 'pointer',
    border: '1px solid var(--border)',
    borderRadius: '999px',
    padding: '2px 12px',
    background: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '13px',
  },
  '.cm-vb-recording': { color: 'oklch(0.577 0.245 27.325)', borderColor: 'currentColor' },
  '.cm-vb-close': { marginLeft: 'auto', padding: '2px 9px' },
  '.cm-vb-time': { fontVariantNumeric: 'tabular-nums', fontSize: '13px', color: 'var(--muted-foreground)' },
  '.cm-vb-status': { fontSize: '13px', color: 'var(--muted-foreground)' },
  '.cm-vb-transcript': { marginTop: '6px', fontSize: '13px', lineHeight: '1.45', whiteSpace: 'pre-wrap' },
  '.cm-vb-dim': { color: 'var(--muted-foreground)', fontStyle: 'italic' },
});

/** pageId: where recordings are saved (none: players only, as on a Home card). */
export function audioBlocks(pageId: string | null, onError: (m: string) => void): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => decorations(state, pageId, onError),
    update: (deco, tr) =>
      tr.docChanged || tr.selection || tr.effects.some((e) => e.is(openRecorder) || e.is(closeRecorder))
        ? decorations(tr.state, pageId, onError)
        : deco,
    provide: (f) => EditorView.decorations.from(f),
  });
  return [recorderAt, field, slashCommand(() => pageId !== null), theme];
}
