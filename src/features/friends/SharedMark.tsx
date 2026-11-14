import { Users } from "lucide-react";
import type { ShareKind } from "../../lib/sync/social";
import { useSocial } from "../../stores/social";

/** A small "shared" mark for a list or folder in the sidebar. */
export function SharedMark({ kind, id }: { kind: ShareKind; id: string }) {
  const shared = useSocial((s) => s.shares.some((x) => x.kind === kind && x.containerId === id && x.status === "active"));
  return shared ? <Users size={12} strokeWidth={1.75} aria-label="Shared" className="shrink-0 text-muted" /> : null;
}
