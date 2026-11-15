/*
 * Which shares cover a list or folder (D262): the container's own share plus up to 3 shared folders
 * above it, and the best role among them. Pure: takes the shares and folders it is given.
 */

export type Role = "owner" | "editor" | "viewer";
/** What these rules need of a share (lib/sync/social's Share fits). */
export type ShareLike = { kind: "folder" | "list"; containerId: string; role: Role; status: "invited" | "active" };

type Folders = Readonly<Record<string, { id: string; parentId: string | null }>>;
const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
const ABOVE = 3;

/** Folder ids from `folderId` upward, at most 3 (the nesting limit). */
function chain(folders: Folders, folderId: string | null): string[] {
  const out: string[] = [];
  for (let f = folderId; f && folders[f] && out.length < ABOVE; f = folders[f].parentId) out.push(f);
  return out;
}

/** Active shares that give access to a list (its own, or a folder above it). */
export function sharesCoveringList<S extends ShareLike>(shares: readonly S[], folders: Folders, list: { id: string; folderId: string | null }): S[] {
  const up = chain(folders, list.folderId);
  return shares.filter((s) => s.status === "active" && ((s.kind === "list" && s.containerId === list.id) || (s.kind === "folder" && up.includes(s.containerId))));
}

/** Active shares that give access to a folder (itself, or a folder above it). */
export function sharesCoveringFolder<S extends ShareLike>(shares: readonly S[], folders: Folders, folderId: string): S[] {
  const up = chain(folders, folderId);
  return shares.filter((s) => s.status === "active" && s.kind === "folder" && up.includes(s.containerId));
}

/** Your best role through any covering share; null when nothing covers it. */
export function bestRole(covering: readonly ShareLike[]): Role | null {
  return covering.reduce<Role | null>((best, s) => (best === null || RANK[s.role] > RANK[best] ? s.role : best), null);
}

type Lists = Readonly<Record<string, { id: string; folderId: string | null }>>;

/**
 * The one rule for "may I change this list's tasks": false only when every share covering it is
 * view-only (H11). An unshared or unknown list is yours to edit.
 */
export function canEdit(listId: string, lists: Lists, folders: Folders, shares: readonly ShareLike[]): boolean {
  const list = lists[listId];
  return !list || bestRole(sharesCoveringList(shares, folders, list)) !== "viewer";
}
