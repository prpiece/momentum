import { useMemo } from "react";
import { bestRole, sharesCoveringList, type Role } from "@core/domain/shareAccess";
import type { Folder, TaskList } from "@core/domain/types";
import type { Share } from "@core/lib/sync/social";
import { useData } from "@core/stores/data";
import { useSocial } from "@core/stores/social";

/** Your role on a list through its own share or a shared folder above it (access adds up, D262); null when it isn't shared. */
export function roleFor(shares: readonly Share[], lists: Record<string, TaskList>, folders: Record<string, Folder>, listId: string | undefined): Role | null {
  const list = listId ? lists[listId] : undefined;
  return list ? bestRole(sharesCoveringList(shares, folders, list)) : null;
}

/** `role` is null for an unshared list; a viewer gets no editing controls. */
export function useRole(listId: string | undefined) {
  const shares = useSocial((s) => s.shares);
  const lists = useData((s) => s.lists);
  const folders = useData((s) => s.folders);
  const role = useMemo(() => roleFor(shares, lists, folders, listId), [shares, lists, folders, listId]);
  return { role, viewer: role === "viewer" };
}
