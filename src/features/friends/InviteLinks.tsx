import { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/sync/social";
import { toast } from "../../stores/toast";
import { attempt } from "./attempt";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Your live invite links with Revoke (SOC-04). `shareId` shows only that share's links; without it, every link. `reload` refetches after a new link. */
export function InviteLinks({ shareId, reload }: { shareId?: string; reload?: unknown }) {
  const [links, setLinks] = useState<api.MyInvite[]>([]);
  const load = useCallback(async () => {
    try {
      const all = await api.myInvites();
      setLinks(all.filter((l) => (shareId ? l.shareId === shareId : true)));
    } catch (e) {
      toast(e instanceof api.SocialError ? e.message : "Couldn't load your links.");
    }
  }, [shareId]);
  useEffect(() => void load(), [load, reload]);
  if (!links.length) return null;

  return (
    <section aria-label="Links">
      <h3 className="t-label mb-1.5 text-muted">Links · {links.length}</h3>
      <ul className="-mx-2 space-y-px">
        {links.map((l) => (
          <li key={l.code} className="flex min-h-[var(--row)] flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-2 hover:bg-surface-2">
            <span className="min-w-0 flex-1 truncate">
              {l.kind === "friend" ? "Friend link" : `${l.shareName ?? "Share"} · ${l.role === "viewer" ? "view only" : "can edit"}`}
              <span className="ml-2 text-[length:var(--fs-sm)] tabular-nums text-muted">
                {l.maxUses === null ? `${l.uses} used` : `${l.uses} of ${l.maxUses} used`} · until {when(l.expiresAt)}
              </span>
            </span>
            <button type="button" className="btn btn-ghost text-danger" onClick={() => void attempt(() => api.revokeInvite(l.code)).then(load)}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
