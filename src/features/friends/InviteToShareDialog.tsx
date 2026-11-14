import { useMemo, useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { Segmented } from "../../components/ui/Segmented";
import * as api from "../../lib/sync/social";
import { useData } from "../../stores/data";
import { useSocial } from "../../stores/social";
import { toast } from "../../stores/toast";
import { attempt } from "./attempt";

const ROLES = [
  { value: "editor", label: "Can edit" },
  { value: "viewer", label: "View only" },
] as const;

/** Pick one of the shares you own to invite this friend to, with a role. */
export function InviteToShareDialog({ friend, onClose }: { friend: api.Friend; onClose: () => void }) {
  const shares = useSocial((s) => s.shares);
  const lists = useData((s) => s.lists);
  const folders = useData((s) => s.folders);
  const mine = useMemo(() => shares.filter((s) => s.role === "owner" && s.status === "active"), [shares]);
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const label = (s: api.Share) => s.name ?? (s.kind === "list" ? lists[s.containerId]?.name : folders[s.containerId]?.name) ?? "Shared " + s.kind;

  const invite = async (s: api.Share) => {
    setBusy(true);
    if (await attempt(() => api.inviteToShare(s.shareId, friend.id, role))) {
      toast(`Invited @${friend.handle} to ${label(s)}.`);
      onClose();
    }
    setBusy(false);
  };

  return (
    <Dialog label="Invite to a share" onClose={onClose} width="max-w-md">
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">Invite @{friend.handle}</h2>
        {mine.length === 0 ? (
          <p className="text-fg-2">You don't share anything yet. Right-click a list or folder and choose Share…, then invite from here.</p>
        ) : (
          <>
            <Segmented name="inviteRole" label="Invite as" value={role} onChange={setRole} options={ROLES} />
            <ul className="-mx-2 max-h-64 space-y-px overflow-y-auto">
              {mine.map((s) => (
                <li key={s.shareId} className="flex min-h-[var(--row)] items-center gap-3 rounded-control px-2 hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate">{label(s)}</span>
                  <span className="text-[length:var(--fs-xs)] capitalize text-muted">{s.kind}</span>
                  <Button variant="secondary" disabled={busy} onClick={() => void invite(s)}>
                    Invite
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
