import type { Folder } from './channels.ts';

/** True if `candidateId` is `ancestorId` itself or anywhere below it. */
export function isDescendant(folders: Folder[], ancestorId: string, candidateId: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  for (let id: string | null = candidateId; id && !seen.has(id); id = byId.get(id)?.parentId ?? null) {
    if (id === ancestorId) return true;
    seen.add(id);
  }
  return false;
}

export type FolderNode = Folder & { children: FolderNode[] };

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Nested, name-sorted tree. A folder whose parent is missing is shown at the top level. */
export function buildTree(folders: Folder[]): FolderNode[] {
  const nodes = new Map(folders.map((f) => [f.id, { ...f, children: [] as FolderNode[] }]));
  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: FolderNode[]) => {
    list.sort(byName);
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/** Ancestors of `id` from the top level down to the folder itself; [] for Inbox or an unknown id. */
export function folderPath(id: string | null, folders: Folder[]): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  for (let cur = id ? byId.get(id) : undefined; cur && !path.includes(cur); cur = byId.get(cur.parentId ?? '')) {
    path.unshift(cur);
  }
  return path;
}

/** Shift-click: everything between anchor and target (inclusive) in display order. */
export function selectRange(order: string[], anchor: string, target: string): string[] {
  const a = order.indexOf(anchor);
  const b = order.indexOf(target);
  if (a < 0 || b < 0) return [target];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
