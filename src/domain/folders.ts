export const MAX_FOLDER_DEPTH = 3;

type Node = { id: string; parentId: string | null };
type ById = Readonly<Record<string, Node>>;

/** 1 for a top-level folder. A dangling parent counts as top level; the hop cap guards cycles. */
export function folderDepth(folders: ById, id: string): number {
  let depth = 1;
  for (let p = folders[id]?.parentId; p && folders[p] && depth <= MAX_FOLDER_DEPTH * 4; p = folders[p].parentId) depth++;
  return depth;
}

export const childFolders = <T extends Node>(folders: Readonly<Record<string, T>>, parentId: string | null): T[] =>
  Object.values(folders).filter((f) => f.parentId === parentId);

/** Levels in the subtree rooted at `id` (1 for a leaf). Callers must have ruled out cycles. */
function height(folders: ById, id: string): number {
  return 1 + Math.max(0, ...childFolders(folders, id).map((c) => height(folders, c.id)));
}

/** Can `id` (with its subtree) move under `newParentId` (null = top level)? */
export function canNest(folders: ById, id: string, newParentId: string | null): boolean {
  if (!folders[id] || (newParentId !== null && !folders[newParentId])) return false;
  if (newParentId === null) return true;
  if (newParentId === id) return false;
  for (let p: string | null = newParentId; p && folders[p]; p = folders[p].parentId) if (p === id) return false;
  return folderDepth(folders, newParentId) + height(folders, id) <= MAX_FOLDER_DEPTH;
}

/** True when a new subfolder fits under `id`. */
export const canAddChild = (folders: ById, id: string) => folderDepth(folders, id) < MAX_FOLDER_DEPTH;

/** Drops parents that don't exist or that lead back to the folder itself. */
export function repairFolderParents<T extends Node>(list: readonly T[]): T[] {
  const byId = Object.fromEntries(list.map((f) => [f.id, f]));
  const cyclic = (id: string) => {
    const seen = new Set<string>();
    for (let p = byId[id].parentId; p; p = byId[p]?.parentId ?? null) {
      if (p === id || seen.has(p)) return true;
      seen.add(p);
    }
    return false;
  };
  return list.map((f) => (f.parentId && byId[f.parentId] && !cyclic(f.id) ? f : { ...f, parentId: null }));
}
