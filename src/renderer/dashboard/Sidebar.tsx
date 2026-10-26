import { useEffect, useRef, useState } from 'react';
import { AudioLines, House, Mic } from 'lucide-react';
import type { Folder } from '../../shared/channels';
import { buildTree, type FolderNode, isDescendant } from '../../shared/folders';
import { cleanIpcError } from '../../shared/format';
import { FOLDER_MIME, getDragging, notifyDropped, setDragging } from './dnd';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { AccountChip } from './AccountChip';
import type { View } from './App';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const api = window.dashboardApi;
const EXPANDED_KEY = 'vn.expanded';

type Editing = { mode: 'create'; parentId: string | null } | { mode: 'rename'; id: string } | null;
type DropKey = 'inbox' | 'root' | string;

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveExpanded(ids: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
  } catch {
    // per-viewer convenience only
  }
}

type Props = {
  view: View;
  onSelect: (v: View) => void;
  folders: Folder[];
  counts: { inbox: number; all: number; starred: number };
  onNewPage: (folderId: string | null) => void;
};

export function Sidebar({ view, onSelect, folders, counts, onNewPage }: Props) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(loadExpanded);
  const [editing, setEditing] = useState<Editing>(null);
  // Set when a menu action opens an inline input, so the menu doesn't hand focus back and blur it.
  const keepFocus = useRef(false);
  const confirm = useConfirm();
  const [dropKey, setDropKey] = useState<DropKey | null>(null);
  const tree = buildTree(folders);

  // dragleave is unreliable in Chromium; make sure no drop highlight outlives the drag.
  useEffect(() => {
    // Also forget the drag payload: if the dragged row unmounted mid-drag, React never saw its dragend.
    const clear = () => {
      setDropKey(null);
      setDragging(null);
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  const setOpen = (id: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      saveExpanded(next);
      return next;
    });

  const run = (p: Promise<unknown>) => p.catch((e) => toast(cleanIpcError(e)));

  /** Commit an inline create/rename. Resolves false (keeping the input open) on error. */
  const commitName = async (name: string): Promise<boolean> => {
    const current = editing;
    if (!current) return true;
    if (!name.trim()) {
      setEditing(null);
      return true;
    }
    try {
      if (current.mode === 'create') {
        const folder = await api.createFolder(name, current.parentId);
        if (current.parentId) setOpen(current.parentId, true);
        onSelect({ kind: 'folder', id: folder.id });
      } else {
        await api.renameFolder(current.id, name);
      }
      setEditing(null);
      return true;
    } catch (e) {
      toast(cleanIpcError(e));
      return false;
    }
  };

  const remove = async (folder: Folder) => {
    const parent = folders.find((f) => f.id === folder.parentId);
    const ok = await confirm({
      title: `Delete "${folder.name}"?`,
      description: `Its notes and subfolders move to ${parent ? parent.name : 'Inbox'}.`,
    });
    if (!ok) return;
    if (view.kind === 'folder' && isDescendant(folders, folder.id, view.id)) onSelect(parent ? { kind: 'folder', id: parent.id } : { kind: 'inbox' });
    run(api.deleteFolder(folder.id));
  };

  // ---- drag & drop -------------------------------------------------------
  const accepts = (key: DropKey): boolean => {
    const d = getDragging();
    if (!d || d.kind === 'widget') return false;
    if (d.kind === 'notes') return key !== 'root';
    if (key === 'inbox') return false;
    if (key === 'root') return folders.find((f) => f.id === d.id)?.parentId !== null;
    return !isDescendant(folders, d.id, key) && folders.find((f) => f.id === d.id)?.parentId !== key;
  };

  const dropProps = (key: DropKey) => ({
    onDragEnter: (e: React.DragEvent) => {
      if (!accepts(key)) return;
      e.preventDefault();
      setDropKey(key);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(key)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropKey((k) => (k === key ? null : k));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropKey(null);
      const d = getDragging();
      if (!d || !accepts(key)) return;
      const target = key === 'inbox' || key === 'root' ? null : key;
      const done =
        d.kind === 'notes'
          ? Promise.all([d.ids.length > 0 && api.moveNotes(d.ids, target), d.pageIds.length > 0 && api.movePages(d.pageIds, target)])
          : api.moveFolder(d.id, target);
      run(done.then(() => target && setOpen(target, true)));
      notifyDropped();
    },
  });

  const ring = (key: DropKey) => (dropKey === key ? 'ring-2 ring-ring bg-background' : '');

  // ---- rendering ---------------------------------------------------------
  const renderNode = (node: FolderNode, depth: number): React.ReactNode => {
    const open = expanded.has(node.id);
    const active = view.kind === 'folder' && view.id === node.id;
    const renaming = editing?.mode === 'rename' && editing.id === node.id;
    // Same actions for the ⋯ dropdown and the right-click context menu.
    const items = (Item: typeof DropdownMenuItem | typeof ContextMenuItem, Separator: React.ElementType) => (
      <>
        <Item
          onSelect={() => {
            keepFocus.current = true;
            setOpen(node.id, true);
            setEditing({ mode: 'create', parentId: node.id });
          }}
        >
          New subfolder
        </Item>
        <Item onSelect={() => onNewPage(node.id)}>New text note</Item>
        <Item
          onSelect={() => {
            keepFocus.current = true;
            setEditing({ mode: 'rename', id: node.id });
          }}
        >
          Rename
        </Item>
        <Separator />
        <Item variant="destructive" onSelect={() => remove(node)}>
          Delete
        </Item>
      </>
    );
    const holdFocus = (e: Event) => {
      if (keepFocus.current) {
        e.preventDefault();
        keepFocus.current = false;
      }
    };
    return (
      <li key={node.id}>
        <ContextMenu>
        <ContextMenuTrigger asChild>
        <div
          {...dropProps(node.id)}
          draggable={!renaming}
          onDragStart={(e) => {
            setDragging({ kind: 'folder', id: node.id });
            e.dataTransfer.setData(FOLDER_MIME, node.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setDragging(null)}
          className={`group relative flex items-center rounded-lg pr-1 text-sm transition-colors ${
            active ? 'bg-background font-medium shadow-sm ring-1 ring-border' : 'text-sidebar-foreground/85 hover:bg-sidebar-accent'
          } ${ring(node.id)}`}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <button
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen(node.id, !open)}
            className={`grid h-6 w-5 shrink-0 place-items-center text-muted-foreground hover:text-foreground ${
              node.children.length ? '' : 'invisible'
            }`}
          >
            <Chevron open={open} />
          </button>
          {renaming ? (
            <NameInput initial={node.name} onCommit={commitName} />
          ) : (
            <button
              onClick={() => onSelect({ kind: 'folder', id: node.id })}
              onDoubleClick={() => setEditing({ mode: 'rename', id: node.id })}
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
            >
              <FolderIcon />
              <span className="truncate">{node.name}</span>
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Folder options"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <Dots />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44" onCloseAutoFocus={holdFocus}>
              {items(DropdownMenuItem, DropdownMenuSeparator)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44" onCloseAutoFocus={holdFocus}>
          {items(ContextMenuItem, ContextMenuSeparator)}
        </ContextMenuContent>
        </ContextMenu>
        {(open || (editing?.mode === 'create' && editing.parentId === node.id)) && (
          <ul>
            {editing?.mode === 'create' && editing.parentId === node.id && (
              <NewFolderRow depth={depth + 1} onCommit={commitName} />
            )}
            {open && node.children.map((c) => renderNode(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3 pt-3">
        <NavItem
          label="Home"
          active={view.kind === 'home'}
          onClick={() => onSelect({ kind: 'home' })}
          icon={<House className="h-4 w-4 shrink-0" strokeWidth={1.8} />}
        />
        <NavItem
          label="Dictation"
          active={view.kind === 'dictation'}
          onClick={() => onSelect({ kind: 'dictation' })}
          icon={<Mic className="h-4 w-4 shrink-0" strokeWidth={1.8} />}
        />
        <NavItem
          label="Inbox"
          count={counts.inbox}
          active={view.kind === 'inbox'}
          onClick={() => onSelect({ kind: 'inbox' })}
          icon="M4 13h4l2 3h4l2-3h4M5 5h14l1 8v6H4v-6l1-8Z"
          extra={ring('inbox')}
          {...dropProps('inbox')}
        />
        <NavItem
          label="All notes"
          count={counts.all}
          active={view.kind === 'all'}
          onClick={() => onSelect({ kind: 'all' })}
          icon="M4 6h16M4 12h16M4 18h10"
        />
        <NavItem
          label="Starred"
          count={counts.starred}
          active={view.kind === 'starred'}
          onClick={() => onSelect({ kind: 'starred' })}
          icon="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"
        />

        <div
          {...dropProps('root')}
          className={`mt-5 flex items-center justify-between rounded-md px-2 py-1 ${ring('root')}`}
        >
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Folders</span>
          <button
            aria-label="New folder"
            title="New folder"
            onClick={() => setEditing({ mode: 'create', parentId: null })}
            className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <ul className="flex flex-col gap-0.5">
          {editing?.mode === 'create' && editing.parentId === null && <NewFolderRow depth={0} onCommit={commitName} />}
          {tree.map((n) => renderNode(n, 0))}
        </ul>
        {tree.length === 0 && editing === null && (
          <p className="px-2 py-1 text-xs text-muted-foreground/70">No folders yet. Click + to create one.</p>
        )}
      </div>
      <div className="border-t border-sidebar-border px-3 py-3">
        <AccountChip active={view.kind === 'account'} onOpen={() => onSelect({ kind: 'account' })} />
        <NavItem
          label="Transcription"
          active={view.kind === 'transcription'}
          onClick={() => onSelect({ kind: 'transcription' })}
          icon={<AudioLines className="h-4 w-4 shrink-0" strokeWidth={1.8} />}
        />
        <NavItem
          label="Settings"
          active={view.kind === 'settings'}
          onClick={() => onSelect({ kind: 'settings' })}
          icon="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z"
        />
      </div>
    </aside>
  );
}

type NavItemProps = {
  label: string;
  /** An SVG path, or a ready icon element. */
  icon: string | React.ReactNode;
  active: boolean;
  onClick: () => void;
  count?: number;
  extra?: string;
} & Partial<Record<'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop', (e: React.DragEvent) => void>>;

function NavItem({ label, icon, active, onClick, count, extra = '', ...drop }: NavItemProps) {
  return (
    <button
      {...drop}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
        active ? 'bg-background font-medium shadow-sm ring-1 ring-border' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent'
      } ${extra}`}
    >
      {typeof icon === 'string' ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        icon
      )}
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-xs tabular-nums text-muted-foreground/70">{count}</span>}
    </button>
  );
}

function NewFolderRow({ depth, onCommit }: { depth: number; onCommit: (name: string) => Promise<boolean> }) {
  return (
    <li className="flex items-center gap-2 py-0.5" style={{ paddingLeft: 6 + depth * 14 + 20 }}>
      <FolderIcon />
      <NameInput initial="" onCommit={onCommit} />
    </li>
  );
}

function NameInput({ initial, onCommit }: { initial: string; onCommit: (name: string) => Promise<boolean> }) {
  const ref = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  useEffect(() => ref.current?.select(), []);

  const commit = async (value: string) => {
    if (busy.current) return;
    busy.current = true;
    const ok = await onCommit(value);
    busy.current = false;
    if (!ok) ref.current?.focus();
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      placeholder="Folder name"
      maxLength={100}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value);
        if (e.key === 'Escape') {
          busy.current = true; // the unmount blur must not commit
          onCommit('');
        }
      }}
      onBlur={(e) => {
        if (!busy.current) commit(e.currentTarget.value);
      }}
      className="min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 py-0.5 text-sm outline-none focus:border-ring"
    />
  );
}


const FolderIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" strokeLinejoin="round" />
  </svg>
);

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Dots = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);
