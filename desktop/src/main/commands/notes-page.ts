import type { Settings } from '../../shared/channels';
import type { PageStore } from '../store/page-store';

export const QUICK_NOTES_TITLE = 'Quick notes';

/** The built-in Quick notes page always exists. Returns the patch that makes it so, or null when it does. */
export function ensureNotesPage(settings: Settings, pages: Pick<PageStore, 'get' | 'create' | 'rename'>): Partial<Settings> | null {
  if (settings.notesPageId && pages.get(settings.notesPageId)) return null;
  const id = pages.create(null).id;
  pages.rename(id, QUICK_NOTES_TITLE);
  return { notesPageId: id };
}
