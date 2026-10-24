import type { Folder } from './channels';

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
