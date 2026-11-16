import { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/sync/social";
import { toast } from "../../stores/toast";
import { attempt, who } from "./attempt";

/** People you blocked, with Unblock (SOC-11). Hidden while the list is empty. */
export function BlockedSection({ reload }: { reload?: unknown }) {
  const [blocked, setBlocked] = useState<api.Profile[]>([]);
  const load = useCallback(async () => {
    try {
      setBlocked(await api.myBlocks());
    } catch (e) {
      toast(e instanceof api.SocialError ? e.message : "Couldn't load the people you blocked.");
    }
  }, []);
  useEffect(() => void load(), [load, reload]);
  if (!blocked.length) return null;

  return (
    <section aria-label="Blocked people">
      <h3 className="t-label mb-2 text-muted">Blocked · {blocked.length}</h3>
      <ul className="overflow-hidden rounded-card border border-border bg-surface [&>li+li]:border-t [&>li+li]:border-border">
        {blocked.map((p) => (
          <li key={p.id} className="flex min-h-[var(--row)] items-center gap-3 px-3.5">
            <span className="min-w-0 flex-1 truncate">{who(p)}</span>
            <button type="button" className="btn btn-secondary" onClick={() => void attempt(() => api.unblockAccount(p.id)).then(load)}>
              Unblock
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
