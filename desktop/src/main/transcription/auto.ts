import type { Folder, Note, Settings } from '../../shared/channels';
import { matchFolderCommand } from '../../shared/folder-command';
import { defaultTitle } from '../../shared/format';
import type { TranscribeLanguage } from '../../shared/transcription';

// New notes recorded on this PC are transcribed without asking (synced ones are left to the PC that
// recorded them: their transcripts arrive with them), and a note still on its default title gets
// one written from its transcript. With auto on, voice to folders reads the start of that transcript
// instead of transcribing the first seconds on their own, so a note costs one call.

const TITLE_TEXT = 2000;
const MIN_TITLE_WORDS = 3;
/** About the 4 s voice to folders listens to when it peeks. */
const FOLDER_WORDS = 12;

export const isDefaultTitle = (n: Pick<Note, 'title' | 'createdAt'>): boolean => n.title === defaultTitle(new Date(n.createdAt));

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

export type AutoDeps = {
  settings(): Pick<Settings, 'autoTranscribe' | 'autoTitle' | 'transcription' | 'voiceToFolders' | 'noteWakeWords'>;
  store: {
    get(id: string): Note | null | undefined;
    rename(id: string, title: string): Note;
    moveNotes(ids: string[], folderId: string | null): void;
    folders: { list(): Folder[] };
  };
  enqueue(ids: string[], language: TranscribeLanguage): void;
  /** Cloud minutes are used up for the month. */
  paused(): boolean;
  title(text: string): Promise<{ title: string | null }>;
  /** Voice to folders by its own peek at the first seconds (auto off). */
  peekFolder(note: Note): Promise<void>;
  onFiled(note: Note, folder: Folder): void;
  notesChanged(): void;
};

export class AutoTranscribe {
  /** Notes queued by `saved`: only these are filed by their transcript (not old notes transcribed by hand). */
  private readonly fresh = new Set<string>();

  constructor(private readonly d: AutoDeps) {}

  /** A note was just recorded on this PC. */
  saved(note: Note): void {
    const s = this.d.settings();
    if (!s.autoTranscribe || !s.transcription.provider || this.d.paused()) {
      void this.d.peekFolder(note);
      return;
    }
    this.fresh.add(note.id);
    this.d.enqueue([note.id], 'auto');
  }

  /** A note's transcript was saved (by auto or by hand). Best effort: never throws. */
  async transcribed(id: string): Promise<void> {
    const note = this.d.store.get(id);
    if (!note) return;
    if (this.fresh.delete(id)) this.file(note);
    await this.retitle(id);
  }

  private file(note: Note): void {
    const s = this.d.settings();
    if (!s.voiceToFolders || note.kind !== 'note' || note.source !== 'mic' || !note.transcript) return;
    const head = words(note.transcript).slice(0, FOLDER_WORDS).join(' ');
    const folder = matchFolderCommand(head, s.noteWakeWords, this.d.store.folders.list());
    if (!folder) return;
    this.d.store.moveNotes([note.id], folder.id);
    this.d.onFiled(note, folder);
  }

  private async retitle(id: string): Promise<void> {
    const note = this.d.store.get(id);
    if (!this.d.settings().autoTitle || !note || !isDefaultTitle(note)) return;
    const text = note.transcript ?? '';
    if (words(text).length < MIN_TITLE_WORDS) return;
    let title: string | null;
    try {
      ({ title } = await this.d.title(text.slice(0, TITLE_TEXT)));
    } catch {
      return; // signed out, offline, daily cap: the note keeps its title
    }
    const now = this.d.store.get(id);
    if (!title || !now || !isDefaultTitle(now)) return; // gone, or the user named it meanwhile
    this.d.store.rename(id, title);
    this.d.notesChanged();
  }
}
