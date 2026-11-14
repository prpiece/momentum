import { audience, type ShareKind } from "../../lib/sync/social";
import { useSync } from "../../lib/sync/engine";
import { useData } from "../../stores/data";
import { useSocial } from "../../stores/social";
import { confirm } from "../../stores/ui";
import { sharesCoveringFolder, sharesCoveringList } from "../../domain/shareAccess";

/**
 * Moving something into a shared list or folder gives its members access (D262): names them and asks first.
 * `from` is the list a task comes from, so a move inside one share doesn't ask. Resolves true to go ahead.
 */
export async function confirmShareMove(kind: ShareKind, id: string, what: string, from?: string): Promise<boolean> {
  const me = useSync.getState().account;
  if (!me) return true;
  const { shares } = useSocial.getState();
  const { lists, folders } = useData.getState();
  const into = kind === "list" ? (lists[id] ? sharesCoveringList(shares, folders, lists[id]) : []) : sharesCoveringFolder(shares, folders, id);
  const already = from && lists[from] ? new Set(sharesCoveringList(shares, folders, lists[from]).map((s) => s.shareId)) : new Set<string>();
  if (into.every((s) => already.has(s.shareId))) return true;
  const people = await audience(kind, id).catch(() => null);
  const others = (people ?? []).filter((p) => p.id !== me);
  if (people && !others.length) return true;
  const names = others.map((p) => `@${p.handle}`).join(", ");
  return confirm(`Share ${what} with other people?`, others.length ? `${names} will be able to see it.` : "Everyone in that share will be able to see it.", "Move");
}
