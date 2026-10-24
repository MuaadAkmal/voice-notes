# Voice Notes v1 — Folders Addendum

Date: 2026-10-24
Status: Design approved in conversation; pending written-spec review
Extends: `2026-10-24-voice-notes-desktop-v1-design.md` (all of its constraints still apply)

## 1. Intent

The user wants Notion/Obsidian-style organisation: folders with nested subfolders, so phrases can be filed by language, film, or anything else. Capture stays frictionless: recording never asks where to save.

**Success criteria**
- Create, rename, nest, move and delete folders from the dashboard sidebar.
- Move one or many notes into a folder by drag & drop.
- Nothing is lost by deleting a folder.

**Decisions (user, 2026-10-24)**
- New recordings always land in **Inbox** (`folderId = null`). No "active folder".
- Folders are **app-only** (database rows). Audio files stay flat in `recordings/<uuid>.webm` and never move.
- Deleting a folder **moves its contents up** to its parent (or Inbox / top level).
- Moving is by **drag & drop** with **multi-select**. No "Move to…" menu in this iteration.

Out of scope: tags, manual ordering of folders/notes (folders sort by name, case-insensitive, `localeCompare`), folder colours/icons, search.

## 2. Data model

Migration #2 (appended to `MIGRATIONS`; `user_version` 1 → 2):

```sql
CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES folders(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX folders_parent ON folders (parent_id);
ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES folders(id);
CREATE INDEX notes_folder ON notes (folder_id);
```

Existing notes get `folder_id = NULL` (Inbox). `Note` gains `folderId: string | null`.

```ts
type Folder = { id: string; name: string; parentId: string | null; createdAt: number; updatedAt: number };
```

**Rules (enforced in the store, surfaced as errors with these exact messages)**
- Name: trimmed, 1–100 chars, must not contain `/` or `\`. Otherwise `Folder name is invalid`.
- Sibling names are unique case-insensitively (siblings = same `parentId`; top level = `parentId null`). Otherwise `A folder named "<name>" already exists here`.
- A folder cannot be moved into itself or any descendant. Otherwise `Can't move a folder into itself`.
- Unknown folder id: `Folder not found`.

**Delete folder F** (single transaction):
1. F's notes → `folder_id = F.parentId`.
2. F's child folders → `parent_id = F.parentId`; if a child's name collides with an existing sibling at the destination, rename it `Name (2)`, `Name (3)`, … (first free).
3. Delete F.

**Move notes**: `moveNotes(ids, folderId | null)`; unknown note ids are ignored; unknown `folderId` → `Folder not found`. Bumps each note's `updatedAt`.

## 3. Store layout

`NoteStore` keeps its public API; it gains `folderId` on notes and `moveNotes`, `deleteMany`. A new `FolderStore` (`src/main/store/folder-store.ts`) shares the same SQLite connection: `NoteStore.open()` builds both and exposes `store.folders`. One DB handle, one migration path.

## 4. IPC (dashboard ↔ main, invoke, zod-validated)

| Channel | Payload | Returns |
|---|---|---|
| `folders:list` | — | `Folder[]` |
| `folders:create` | `{ name, parentId: uuid \| null }` | `Folder` |
| `folders:rename` | `{ id, name }` | `Folder` |
| `folders:move` | `{ id, parentId: uuid \| null }` | `Folder` |
| `folders:delete` | `id` | `void` |
| `notes:move` | `{ ids: uuid[] (1..500), folderId: uuid \| null }` | `void` |
| `notes:delete-many` | `uuid[] (1..500)` | `void` |

Main broadcasts `folders:changed` after folder mutations and `notes:changed` after any note or folder mutation that changes note placement. Store errors reach the renderer as rejected invokes; the dashboard shows the message in a small toast (bottom of the window, 4 s).

## 5. Dashboard UI

**Sidebar** (replaces the Notes/Settings nav):
- `Inbox` (count of notes with `folderId null`), `All notes` (total count).
- `FOLDERS` header with a `+` button (new top-level folder).
- Folder tree, sorted by name; chevron toggles expansion; expanded ids persisted in `localStorage` (`vn.expanded`, try/catch).
- Folder row ⋯ menu / right-click: New subfolder, Rename, Delete (confirm: `Delete "<name>"? Its notes and subfolders move to <parent name or Inbox>.`).
- New folder / rename: inline text input; Enter commits, Esc / blur-with-empty cancels; errors show in the toast and keep the input open.
- `Settings` pinned at the bottom.

**Main pane**:
- Header: breadcrumb for the current view (`Inbox`, `All notes`, or `Spanish › Money Heist`; ancestors clickable).
- Notes directly in the selected folder (not descendants), grouped by day as before. `All notes` shows every note with its folder path as a small label on the row (`Inbox` for unfiled).
- Empty states: Inbox — the existing "hold <hotkey>" copy; folder — `No notes here. Drag notes onto this folder in the sidebar.`

**Selection**: click on a row's empty area selects it alone; Ctrl-click toggles; Shift-click selects the range in the visible order; Esc or clicking empty space clears. Selection resets when the view changes. When ≥1 selected, a bar shows `<n> selected · Delete · Clear`; Delete confirms `Delete <n> notes?`.

**Drag & drop** (HTML5 DnD, custom MIME types `application/x-vn-notes` and `application/x-vn-folder`):
- Dragging a selected row drags the whole selection; dragging an unselected row drags just that note.
- Drop targets for notes: any folder row, `Inbox`. Drop target for folders: any other folder row, the `FOLDERS` header (→ top level). Invalid targets (self/descendant) show no highlight and reject the drop.
- Valid hover target gets a highlight ring; dropping moves, then clears selection.

## 6. Testing

- **Unit (FolderStore)**: create top-level & nested; invalid names; duplicate sibling (case-insensitive) rejected, same name under different parents allowed; rename (incl. duplicate check, excluding itself); move (to top level, into another folder, into self/descendant rejected); delete moves notes + child folders up, with `(2)` suffix on collision; delete top-level moves notes to Inbox.
- **Unit (NoteStore)**: migration from a v1 database keeps notes with `folderId null`; `moveNotes` into folder / back to Inbox / unknown folder throws; `deleteMany` removes files and rows; new notes have `folderId null`.
- **Unit (pure)**: `buildTree(folders)` (sorted, nested), `folderPath(id, folders)`, `isDescendant`, `selectRange` for Shift-click.
- **E2E**: create a folder via the sidebar, drag the recorded note onto it → Inbox empty, folder view shows the note; delete folder → note back in Inbox.
