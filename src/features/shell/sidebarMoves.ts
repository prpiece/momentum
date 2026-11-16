import { after, moveBy, moveNear } from "../../domain/order";
import type { TaskList } from "../../domain/types";
import { updateFolder, updateList, useData } from "../../stores/data";
import { withUndo } from "../../stores/undo";
import { confirmShareMove } from "../friends/moveGuard";

/** The folder a list shows under: a dangling folderId counts as top level, as the sidebar does. */
const homeOf = (l: TaskList, folders: Record<string, unknown>) => (l.folderId && folders[l.folderId] ? l.folderId : null);

/** The lists that share a sidebar row group with `of`: same folder, same pinned state (pinned sort first). */
export function listSiblings(of: TaskList): TaskList[] {
  const { lists, folders } = useData.getState();
  const home = homeOf(of, folders);
  return Object.values(lists).filter((l) => l.id !== "inbox" && !l.archived && !!l.pinned === !!of.pinned && homeOf(l, folders) === home);
}

/** Arrow-key path for reordering: one step among the siblings. */
export function stepList(l: TaskList, delta: -1 | 1) {
  for (const c of moveBy(listSiblings(l), l.id, delta)) updateList(c.id, { sortOrder: c.sortOrder });
}

export function stepFolder(id: string, delta: -1 | 1) {
  const { folders } = useData.getState();
  const f = folders[id];
  if (!f) return;
  for (const c of moveBy(Object.values(folders).filter((x) => x.parentId === f.parentId), id, delta)) updateFolder(c.id, { sortOrder: c.sortOrder });
}

/** Moves a list into a folder (null = top level), at the end; asks first when that folder is shared. */
export async function moveListToFolder(listId: string, folderId: string | null) {
  const { lists, folders } = useData.getState();
  const l = lists[listId];
  if (!l || homeOf(l, folders) === folderId) return;
  if (folderId && !(await confirmShareMove("folder", folderId, "this list"))) return;
  const end = after(Object.values(lists).filter((x) => x.id !== "inbox" && homeOf(x, folders) === folderId));
  withUndo("Moved list", () => updateList(listId, { folderId, sortOrder: end }));
}

/** Dropping a list row on another puts it at that spot, in that row's folder. */
export async function dropListOn(listId: string, targetId: string) {
  const { lists, folders } = useData.getState();
  const l = lists[listId];
  const target = lists[targetId];
  if (!l || !target || listId === targetId) return;
  const home = homeOf(target, folders);
  if (homeOf(l, folders) !== home && home && !(await confirmShareMove("folder", home, "this list"))) return;
  const changes = moveNear(listSiblings(target), listId, targetId);
  withUndo("Moved list", () => {
    updateList(listId, { folderId: home, sortOrder: changes.find((c) => c.id === listId)?.sortOrder ?? l.sortOrder });
    for (const c of changes) if (c.id !== listId) updateList(c.id, { sortOrder: c.sortOrder });
  });
}
