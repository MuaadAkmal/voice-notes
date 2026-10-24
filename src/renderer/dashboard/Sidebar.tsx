import { useEffect, useRef, useState } from 'react';
import type { Folder } from '../../shared/channels';
import { buildTree, type FolderNode, isDescendant } from '../../shared/folders';
import { cleanIpcError } from '../../shared/format';
import { FOLDER_MIME, getDragging, notifyDropped, setDragging } from './dnd';
import { useToast } from './Toast';
import type { View } from './App';

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
  counts: { inbox: number; all: number };
};

export function Sidebar({ view, onSelect, folders, counts }: Props) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(loadExpanded);
  const [editing, setEditing] = useState<Editing>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
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

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuFor]);

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

  const remove = (folder: Folder) => {
    const parent = folders.find((f) => f.id === folder.parentId);
    if (!confirm(`Delete "${folder.name}"? Its notes and subfolders move to ${parent ? parent.name : 'Inbox'}.`)) return;
    if (view.kind === 'folder' && isDescendant(folders, folder.id, view.id)) onSelect(parent ? { kind: 'folder', id: parent.id } : { kind: 'inbox' });
    run(api.deleteFolder(folder.id));
  };

  // ---- drag & drop -------------------------------------------------------
  const accepts = (key: DropKey): boolean => {
    const d = getDragging();
    if (!d) return false;
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
      const done = d.kind === 'notes' ? api.moveNotes(d.ids, target) : api.moveFolder(d.id, target);
      run(done.then(() => target && setOpen(target, true)));
      notifyDropped();
    },
  });

  const ring = (key: DropKey) => (dropKey === key ? 'ring-2 ring-stone-900/70 bg-white' : '');

  // ---- rendering ---------------------------------------------------------
  const renderNode = (node: FolderNode, depth: number): React.ReactNode => {
    const open = expanded.has(node.id);
    const active = view.kind === 'folder' && view.id === node.id;
    const renaming = editing?.mode === 'rename' && editing.id === node.id;
    return (
      <li key={node.id}>
        <div
          {...dropProps(node.id)}
          draggable={!renaming}
          onDragStart={(e) => {
            setDragging({ kind: 'folder', id: node.id });
            e.dataTransfer.setData(FOLDER_MIME, node.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setDragging(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuFor(node.id);
          }}
          className={`group relative flex items-center rounded-lg pr-1 text-sm transition-colors ${
            active ? 'bg-white font-medium shadow-sm ring-1 ring-stone-200' : 'text-stone-700 hover:bg-stone-200/60'
          } ${ring(node.id)}`}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <button
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen(node.id, !open)}
            className={`grid h-6 w-5 shrink-0 place-items-center text-stone-400 hover:text-stone-700 ${
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
          <button
            aria-label="Folder options"
            onClick={(e) => {
              e.stopPropagation();
              setMenuFor(menuFor === node.id ? null : node.id);
            }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-stone-400 opacity-0 hover:bg-stone-200 hover:text-stone-700 group-hover:opacity-100"
          >
            <Dots />
          </button>
          {menuFor === node.id && (
            <div className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 text-sm font-normal shadow-lg">
              <MenuItem
                onClick={() => {
                  setOpen(node.id, true);
                  setEditing({ mode: 'create', parentId: node.id });
                }}
              >
                New subfolder
              </MenuItem>
              <MenuItem onClick={() => setEditing({ mode: 'rename', id: node.id })}>Rename</MenuItem>
              <MenuItem danger onClick={() => remove(node)}>
                Delete
              </MenuItem>
            </div>
          )}
        </div>
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
    <aside className="flex w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-100/70">
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3 pt-3">
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

        <div
          {...dropProps('root')}
          className={`mt-5 flex items-center justify-between rounded-md px-2 py-1 ${ring('root')}`}
        >
          <span className="text-[11px] font-medium uppercase tracking-wider text-stone-500">Folders</span>
          <button
            aria-label="New folder"
            title="New folder"
            onClick={() => setEditing({ mode: 'create', parentId: null })}
            className="grid h-5 w-5 place-items-center rounded text-stone-500 hover:bg-stone-200 hover:text-stone-800"
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
          <p className="px-2 py-1 text-xs text-stone-400">No folders yet. Click + to create one.</p>
        )}
      </div>
      <div className="border-t border-stone-200 px-3 py-3">
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
  icon: string;
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
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
        active ? 'bg-white font-medium shadow-sm ring-1 ring-stone-200' : 'text-stone-600 hover:bg-stone-200/60'
      } ${extra}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-xs tabular-nums text-stone-400">{count}</span>}
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
      className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-1.5 py-0.5 text-sm outline-none focus:border-stone-500"
    />
  );
}

function MenuItem({ children, danger, onClick }: { children: React.ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left hover:bg-stone-100 ${danger ? 'text-red-600' : 'text-stone-700'}`}
    >
      {children}
    </button>
  );
}

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-stone-500" fill="none" stroke="currentColor" strokeWidth={1.8}>
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
