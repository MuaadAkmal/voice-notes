# Voice Notes Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add nested, app-only folders to Voice Notes: a sidebar tree, folder views, multi-select and drag & drop moving, with new recordings landing in Inbox.

**Architecture:** A `FolderStore` shares `NoteStore`'s SQLite connection (migration #2 adds `folders` + `notes.folder_id`). Pure tree/selection helpers live in `src/shared/folders.ts` and are used by both main (cycle check) and the dashboard. The dashboard gains a view model (`Inbox | All notes | folder | Settings`), a sidebar tree, a selection model and HTML5 drag & drop.

**Tech Stack:** unchanged (Electron 45, React 19, Tailwind 4, better-sqlite3 + drizzle, zod, Vitest under Electron-as-Node, Playwright `_electron`).

**Spec:** `docs/superpowers/specs/2026-10-24-voice-notes-folders-design.md` (extends `docs/superpowers/specs/2026-10-24-voice-notes-desktop-v1-design.md`)

## Global Constraints

- Branch `feat/desktop-v1`; v1 constraints from the v1 plan still apply (sandboxed renderers, zod-validated IPC, `npm test` under Electron-as-Node, commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Migrations are append-only: add index 1 to `MIGRATIONS`; never edit index 0.
- Error messages exactly: `Folder name is invalid`, `A folder named "<name>" already exists here`, `Can't move a folder into itself`, `Folder not found`.
- Folder names: trimmed, 1–100 chars, no `/` or `\`; sibling uniqueness case-insensitive; folders sorted by `name.localeCompare(other, undefined, { sensitivity: 'base' })`.
- Collision rename on delete: `Name (2)`, `Name (3)`, … first free.
- Bulk ops: 1–500 ids. Toast: bottom of window, 4 000 ms.
- DnD MIME types: `application/x-vn-notes` (JSON `string[]`), `application/x-vn-folder` (folder id).
- `localStorage` key `vn.expanded` (JSON `string[]`), every access in try/catch.

## Review Focus

1. **Deleting a folder whose subfolder name collides at the destination** (e.g. delete `Spanish` containing `Films` while top level already has `Films`) → child becomes `Films (2)`, nothing lost → pinned in Task 1 (`delete renames colliding children`).
2. **Dropping a folder onto its own descendant** (drag `Spanish` onto `Spanish › Films`) → rejected, tree unchanged → pinned in Task 1 (`move into descendant throws`) and Task 3 (`isDescendant`).
3. **Store errors shown to the user**: Electron prefixes rejected invokes with `Error invoking remote method '…': Error: ` → toast must show only the store message → pinned in Task 3 (`cleanIpcError`).
4. **Existing v1 database upgrade**: user already has notes; migration must keep them, in Inbox → pinned in Task 2 (`migrates a v1 database`).
5. **Notes moved/deleted while selected or playing** — the selection must drop ids that no longer appear in the current view; playback of a deleted note stops → pinned in Task 5 (selection pruned on `notes:changed`; manual check) and existing delete behaviour.

---

## File Structure

```
src/shared/channels.ts        + Folder type, Note.folderId, new channel names
src/shared/ipc.ts             + FolderNameSchema-free payload schemas (CreateFolder, RenameFolder, MoveFolder, MoveNotes, IdList)
src/shared/folders.ts         NEW pure: buildTree, folderPath, isDescendant, selectRange
src/shared/format.ts          + cleanIpcError
src/main/store/migrations.ts  + migration #2
src/main/store/schema.ts      + folders table, notes.folderId
src/main/store/folder-store.ts NEW FolderStore
src/main/store/note-store.ts  + folders, moveNotes, deleteMany, folderId on create/adopt
src/main/ipc.ts               + folder + bulk handlers
src/main/index.ts             + broadcast folders:changed
src/preload/dashboard.ts      + folder/bulk API, onFoldersChanged
src/renderer/dashboard/App.tsx          view model + layout (rewritten)
src/renderer/dashboard/Sidebar.tsx      NEW tree, inline create/rename, menus, drop targets
src/renderer/dashboard/NotesPage.tsx    takes view; selection + drag source + selection bar
src/renderer/dashboard/NoteRow.tsx      + selected state, folder label, drag handle props
src/renderer/dashboard/Toast.tsx        NEW toast provider + useToast
tests/unit/folder-store.test.ts, tests/unit/folders.test.ts, tests/unit/note-store.test.ts (extend), tests/unit/format.test.ts (extend)
tests/e2e/folders.spec.ts
```

---

### Task 1: Migration #2 + FolderStore

**Files:**
- Modify: `src/shared/channels.ts`, `src/main/store/migrations.ts`, `src/main/store/schema.ts`, `src/main/store/note-store.ts` (construct + expose `folders`)
- Create: `src/main/store/folder-store.ts`, `src/shared/folders.ts` (only `isDescendant` in this task)
- Test: `tests/unit/folder-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // channels.ts
  export type Folder = { id: string; name: string; parentId: string | null; createdAt: number; updatedAt: number };
  // Note gains: folderId: string | null
  // shared/folders.ts
  export function isDescendant(folders: Folder[], ancestorId: string, candidateId: string): boolean; // true if candidate === ancestor or below it
  // folder-store.ts
  export class FolderStore {
    constructor(db: BetterSQLite3Database, sqlite: Database.Database, now: () => number);
    list(): Folder[];                                   // unsorted
    get(id: string): Folder | undefined;
    create(name: string, parentId: string | null): Folder;
    rename(id: string, name: string): Folder;
    move(id: string, parentId: string | null): Folder;
    delete(id: string): void;                           // moves notes + children up, one transaction
  }
  // NoteStore: readonly folders: FolderStore
  ```

- [ ] **Step 1: Write failing tests** (`NoteStore.open(tmp)` then `store.folders`; fixed clock)

```ts
it('creates top-level and nested folders')           // create('Spanish', null); create('Films', spanish.id) → parentId set; list() length 2
it('rejects invalid names')                          // '', '   ', 'a/b', 'a\\b', 'x'.repeat(101) → toThrow('Folder name is invalid')
it('trims names')                                    // create('  Spanish ') → name 'Spanish'
it('rejects duplicate sibling names case-insensitively') // 'Spanish' then 'spanish' at top → toThrow('A folder named "spanish" already exists here')
it('allows the same name under different parents')
it('rename checks duplicates but not against itself')  // rename(a.id,'SPANISH') ok when a is 'Spanish'; rename to sibling's name throws
it('moves to top level and into another folder')
it('move into self or descendant throws')            // move(spanish, spanish) and move(spanish, films) → toThrow("Can't move a folder into itself")
it('move/rename/delete unknown id throws Folder not found')
it('delete moves notes and children up')             // Spanish > Films; note in Spanish; delete Spanish → note.folderId null, Films.parentId null
it('delete renames colliding children')              // top: Films, Spanish > Films; delete Spanish → names ['Films','Films (2)']
it('delete of a nested folder moves notes to its parent')
```
(Notes for these tests are created with `store.create(audio)` then placed with a raw `UPDATE notes SET folder_id` via `store.moveNotes` once Task 2 exists — in this task, use `(store as any).sqlite.prepare('UPDATE notes SET folder_id=? WHERE id=?').run(...)`. Task 2 replaces it with `moveNotes`.)

- [ ] **Step 2: Run** `npm test -- folder-store` → Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Migration #2 SQL exactly as spec §2. Schema: `folders` table + `folderId: text('folder_id')` on notes. `FolderStore` validates names via a private `cleanName(name)`; sibling check via `list()` filter; `move` uses `isDescendant`; `delete` runs inside `sqlite.transaction`. NoteStore `create`/adopt set `folderId: null`.
- [ ] **Step 4: Run** `npm test` → Expected: all pass (existing 50 + new).
- [ ] **Step 5: Commit** `feat: folders table and folder store`

---

### Task 2: NoteStore bulk move/delete + upgrade test

**Files:**
- Modify: `src/main/store/note-store.ts`, `tests/unit/folder-store.test.ts` (swap raw UPDATE for `moveNotes`)
- Test: `tests/unit/note-store.test.ts`

**Interfaces:**
- Produces: `NoteStore.moveNotes(ids: string[], folderId: string | null): void` (throws `Folder not found`; unknown note ids ignored; bumps `updatedAt`), `NoteStore.deleteMany(ids: string[]): Promise<void>`.

- [ ] **Step 1: Write failing tests**

```ts
it('new notes start in Inbox')                 // create → folderId null
it('moveNotes into a folder and back to Inbox')
it('moveNotes to an unknown folder throws')    // toThrow('Folder not found')
it('moveNotes ignores unknown note ids')
it('deleteMany removes files and rows')
it('migrates a v1 database')                   // build a DB with only MIGRATIONS[0], user_version=1, insert a note row; NoteStore.open → note listed with folderId null; folders.list() []
```
- [ ] **Step 2: Run** `npm test -- note-store` → FAIL. **Step 3:** implement. **Step 4:** `npm test` → all pass.
- [ ] **Step 5: Commit** `feat: bulk move and delete notes`

---

### Task 3: Pure helpers — tree, path, range selection, IPC error text

**Files:**
- Modify: `src/shared/folders.ts`, `src/shared/format.ts`
- Test: `tests/unit/folders.test.ts`, `tests/unit/format.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FolderNode = Folder & { children: FolderNode[] };
  export function buildTree(folders: Folder[]): FolderNode[];                    // sorted per Global Constraints at every level; orphans (parent missing) treated as top level
  export function folderPath(id: string | null, folders: Folder[]): Folder[];    // root → id; [] for null/unknown
  export function selectRange(order: string[], anchor: string, target: string): string[]; // inclusive slice in `order`; [target] if anchor absent
  export function cleanIpcError(err: unknown): string;                          // strips "Error invoking remote method '<ch>': " and a leading "Error: "
  ```

- [ ] **Step 1: Write failing tests**

```ts
it('buildTree nests and sorts case-insensitively')   // [b, A, a>child] → names ['A','b'] / children of 'a'... (use distinct ids)
it('buildTree treats orphans as top level')
it('folderPath returns root-to-leaf')                // Spanish > Films > Narcos → ['Spanish','Films','Narcos']
it('isDescendant true for self and below, false for siblings/ancestors')
it('selectRange forwards and backwards')             // ['a','b','c','d'] a→c = [a,b,c]; d→b = [b,c,d]
it('selectRange without anchor selects target')
it('cleanIpcError strips electron prefix')           // new Error("Error invoking remote method 'folders:create': Error: A folder named \"x\" already exists here") → 'A folder named "x" already exists here'
it('cleanIpcError handles plain values')             // 'boom' → 'boom'
```
- [ ] **Step 2–4:** RED → implement → `npm test` all pass.
- [ ] **Step 5: Commit** `feat: folder tree and selection helpers`

---

### Task 4: IPC + preload for folders and bulk ops

**Files:**
- Modify: `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/dashboard.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  ```ts
  // Ch additions
  FoldersList: 'folders:list', FoldersCreate: 'folders:create', FoldersRename: 'folders:rename',
  FoldersMove: 'folders:move', FoldersDelete: 'folders:delete', NotesMove: 'notes:move',
  NotesDeleteMany: 'notes:delete-many', FoldersChanged: 'folders:changed',
  // zod
  CreateFolderSchema = { name: string(max 200), parentId: uuid | null }
  RenameFolderSchema = { id: uuid, name: string(max 200) }
  MoveFolderSchema = { id: uuid, parentId: uuid | null }
  MoveNotesSchema = { ids: uuid[] 1..500, folderId: uuid | null }
  IdListSchema = uuid[] 1..500
  // window.dashboardApi additions
  listFolders(): Promise<Folder[]>; createFolder(name, parentId): Promise<Folder>; renameFolder(id, name): Promise<Folder>;
  moveFolder(id, parentId): Promise<Folder>; deleteFolder(id): Promise<void>;
  moveNotes(ids, folderId): Promise<void>; deleteNotes(ids): Promise<void>; onFoldersChanged(cb): () => void
  ```
  Name validation stays in the store (so its exact messages reach the UI); zod only bounds length/shape.

- [ ] **Step 1:** add handlers in `registerDashboardIpc` (deps gain `foldersChanged: () => void`); every folder mutation calls `foldersChanged()` and `notesChanged()` (delete/move can change note placement & counts); `NotesMove`/`NotesDeleteMany` call `notesChanged()`.
- [ ] **Step 2: Verify** `npx tsc --noEmit` clean; `npm test` all pass.
- [ ] **Step 3: Commit** `feat: folder ipc`

---

### Task 5: Dashboard — sidebar tree, views, selection, drag & drop, toast

**Files:**
- Create: `src/renderer/dashboard/Sidebar.tsx`, `src/renderer/dashboard/Toast.tsx`
- Modify: `src/renderer/dashboard/App.tsx`, `NotesPage.tsx`, `NoteRow.tsx`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
  ```ts
  export type View = { kind: 'inbox' } | { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'settings' };
  // Toast.tsx
  export function ToastProvider({ children }): JSX.Element; export function useToast(): (message: string) => void;
  // Sidebar props
  { view: View; onSelect(v: View): void; folders: Folder[]; counts: { inbox: number; all: number }; }
  // NotesPage props
  { view: View; folders: Folder[]; onNavigate(v: View): void }
  ```

- [ ] **Step 1: App** loads `listFolders()` + `listNotes()` (re-load on `onFoldersChanged`/`onNotesChanged`), owns `view` (default Inbox; if the viewed folder disappears → Inbox), wraps in `ToastProvider`, renders `Sidebar` + `NotesPage`/`SettingsPage`.
- [ ] **Step 2: Sidebar** per spec §5: Inbox/All notes rows with counts; `FOLDERS` header with `+`; recursive tree from `buildTree` with chevrons (`vn.expanded`); inline input for new/rename (Enter commits via API, error → toast and keep input; Esc/blank blur cancels); ⋯ menu + `onContextMenu`: New subfolder (auto-expands parent), Rename, Delete (spec confirm copy). Settings pinned bottom. Drop targets: folder rows + Inbox accept `application/x-vn-notes` → `moveNotes`; folder rows + `FOLDERS` header accept `application/x-vn-folder` → `moveFolder` (reject when `isDescendant(folders, dragged, target)`; highlight only valid targets — compute on `dragenter` using a module-level `draggingFolderId`, since `dataTransfer` data is unreadable during dragover). Folder rows are draggable.
- [ ] **Step 3: NotesPage** filters notes by view (`inbox` → `folderId null`; `folder` → `folderId === id`; `all` → all), breadcrumb via `folderPath` (ancestors clickable), folder label per row in All notes (`folderPath(...).map(f => f.name).join(' › ') || 'Inbox'`), empty states per spec. Selection: `Set<string>` + anchor; click row empty area = select only; Ctrl-click toggle; Shift-click `selectRange(visibleOrder, anchor, id)`; Esc / click on page background clears; reset on view change; prune ids not in the view when notes change. Selection bar `<n> selected · Delete · Clear` (Delete → `confirm('Delete <n> notes?')` → `deleteNotes`, stop playback if the playing note is among them). Rows are draggable: payload = selection if the row is selected, else `[id]`.
- [ ] **Step 4: NoteRow** gains `selected`, `folderLabel?`, `onSelect(e: React.MouseEvent)`, `onDragStart(e)`; selected rows get a stone-100 background + left accent; buttons/inputs inside the row stop propagation so play/rename/menu don't change selection. All rename/delete/move calls `.catch(e => toast(cleanIpcError(e)))`.
- [ ] **Step 5: Verify** `npx tsc --noEmit` clean, `npm test` pass.
- [ ] **Step 6: Manual check** (`npm start`, capture via PrintWindow): create `Spanish` › `Films`, rename, duplicate name shows toast, drag a note into `Films` (Inbox count drops), Shift-select 2 notes and drag to `Spanish`, drag `Spanish` onto `Films` is refused, delete `Spanish` → `Films` top level and notes moved up.
- [ ] **Step 7: Commit** `feat: folder sidebar, views, selection and drag & drop`

---

### Task 6: E2E for folders

**Files:**
- Create: `tests/e2e/folders.spec.ts` (reuse the launch/hook pattern of `record.spec.ts`; extract shared launch into `tests/e2e/launch.ts` if duplication exceeds ~20 lines)

- [ ] **Step 1: Write test** `folders: create, drag a note in, delete folder returns it to Inbox`:
  record one note via hooks (toggle, 1 500 ms, toggle) → click `+` in sidebar, type `Spanish`, Enter → `Spanish` row visible → `dragTo` the note row onto the `Spanish` row → Inbox view shows `No notes yet` / count 0, clicking `Spanish` shows the note, `store.list()[0].folderId` equals the folder id → delete `Spanish` via its ⋯ menu (accept dialog) → note back in Inbox (`folderId null`).
- [ ] **Step 2: Run** `npm run test:e2e` → Expected: 3 passed. If HTML5 `dragTo` is unreliable in Electron, dispatch the drag via `page.dispatchEvent` with a shared `DataTransfer` handle (ledger the ruling).
- [ ] **Step 3: Update `CLAUDE.md`** architecture (FolderStore, shared/folders.ts, View model).
- [ ] **Step 4: Commit** `test: folders e2e`

---

## Spec coverage map

| Spec § | Task |
|---|---|
| 2 Data model, rules, delete semantics, moveNotes | 1, 2 |
| 3 Store layout | 1, 2 |
| 4 IPC + broadcasts + toast errors | 3 (cleanIpcError), 4, 5 |
| 5 Sidebar, main pane, selection, DnD | 5 |
| 6 Testing | 1, 2, 3, 6 |
