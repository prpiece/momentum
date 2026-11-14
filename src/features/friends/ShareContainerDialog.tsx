import { useCallback, useEffect, useMemo, useState } from "react";
import { Segmented } from "../../components/ui/Segmented";
import { Button, Dialog } from "../../components/ui/Dialog";
import { inviteUrl } from "../../domain/invite";
import { useSync } from "../../lib/sync/engine";
import * as api from "../../lib/sync/social";
import { useData } from "../../stores/data";
import { useSocial } from "../../stores/social";
import { toast } from "../../stores/toast";
import { confirm } from "../../stores/ui";
import { sharesCoveringFolder, sharesCoveringList } from "../../domain/shareAccess";
import { attempt, copyText, who } from "./attempt";

const ROLES = [
  { value: "editor", label: "Can edit" },
  { value: "viewer", label: "View only" },
] as const;
const roleText = (r: api.Role) => (r === "owner" ? "Owner" : r === "editor" ? "Can edit" : "View only");

/** Share a list or folder: members and roles, friends to invite, an invite link, and leaving or stopping (D262). */
export function ShareContainerDialog({ kind, id, onClose }: { kind: api.ShareKind; id: string; onClose: () => void }) {
  const me = useSync((s) => s.account);
  const shares = useSocial((s) => s.shares);
  const allFriends = useSocial((s) => s.friends);
  const list = useData((s) => s.lists[id]);
  const folder = useData((s) => s.folders[id]);
  const folders = useData((s) => s.folders);
  const name = (kind === "list" ? list?.name : folder?.name) ?? "this";
  const share = useMemo(() => shares.find((s) => s.kind === kind && s.containerId === id && s.status === "active"), [shares, kind, id]);
  const inherited = useMemo(() => {
    if (share) return null;
    const cover = kind === "list" ? (list ? sharesCoveringList(shares, folders, list) : []) : sharesCoveringFolder(shares, folders, id);
    return cover[0] ?? null;
  }, [share, shares, folders, kind, list, id]);
  const owner = share?.role === "owner";
  const [members, setMembers] = useState<api.Member[]>([]);
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shareId = share?.shareId;

  const load = useCallback(async () => {
    if (!shareId) return setMembers([]);
    try {
      setMembers(await api.shareMembers(shareId));
    } catch (e) {
      toast(e instanceof api.SocialError ? e.message : "Couldn't load the members.");
    }
  }, [shareId]);
  useEffect(() => void load(), [load]);

  const run = async (fn: () => Promise<unknown>, pull = false) => {
    setBusy(true);
    const ok = await attempt(fn, pull);
    await load();
    setBusy(false);
    return ok;
  };

  const candidates = useMemo(() => {
    const taken = new Set(members.map((m) => m.id));
    return allFriends.filter((f) => f.status === "accepted" && !taken.has(f.id));
  }, [allFriends, members]);

  const makeLink = async () => {
    if (!share) return;
    setBusy(true);
    try {
      const url = inviteUrl(await api.createShareInvite(share.shareId, role));
      setLink(url);
      toast((await copyText(url)) ? "Link copied. It works for 7 days." : "Link made. Copy it from the box.");
    } catch (e) {
      toast(e instanceof api.SocialError ? e.message : "Couldn't make a link.");
    }
    setBusy(false);
  };

  const stop = async () => {
    if (!share || !(await confirm(`Stop sharing “${name}”?`, "Everyone else loses access, and the list is removed from their devices. Your tasks stay.", "Stop sharing"))) return;
    if (await run(() => api.deleteShare(share.shareId), true)) onClose();
  };
  const leave = async () => {
    if (!share || !me || !(await confirm(`Leave “${name}”?`, "You lose access, and it disappears from your devices.", "Leave"))) return;
    if (await run(() => api.removeMember(share.shareId, me), true)) onClose();
  };

  return (
    <Dialog label={`Share ${name}`} onClose={onClose} width="max-w-lg">
      <div className="space-y-5 p-6">
        <div>
          <h2 className="truncate text-lg font-semibold">Share “{name}”</h2>
          <p className="mt-0.5 text-[length:var(--fs-sm)] text-muted">{kind === "folder" ? "Everyone you invite sees every list in this folder." : "Everyone you invite sees every task in this list."} Your reminders and tags stay yours.</p>
        </div>

        {!me ? (
          <p className="text-fg-2">Sign in from Settings → Account to share.</p>
        ) : inherited ? (
          <p className="text-fg-2">This is already shared through a folder above it. Manage that share from the folder.</p>
        ) : !share ? (
          <div className="space-y-3">
            <p className="text-fg-2">Not shared yet. Nothing leaves your devices until you start sharing and invite someone.</p>
            <Button variant="primary" disabled={busy} onClick={() => void run(() => api.createShare(kind, id))}>
              Start sharing
            </Button>
          </div>
        ) : (
          <>
            <section aria-label="Members">
              <h3 className="t-label mb-1.5 text-muted">People · {members.length}</h3>
              <ul className="-mx-2 space-y-px">
                {members.map((m) => (
                  <li key={m.id} className="flex min-h-[var(--row)] flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-2 hover:bg-surface-2">
                    <span className="min-w-0 flex-1 truncate">
                      {m.id === me ? "You" : who(m)}
                      {m.status === "invited" && <span className="ml-2 text-[length:var(--fs-xs)] text-muted">Invited</span>}
                    </span>
                    {owner && m.role !== "owner" ? (
                      <>
                        <select
                          aria-label={`Role for @${m.handle}`}
                          className="input w-auto"
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => void run(() => api.setMemberRole(share.shareId, m.id, e.target.value === "viewer" ? "viewer" : "editor"))}
                        >
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        {m.status === "active" && (
                          <Button
                            disabled={busy}
                            onClick={async () => {
                              if (await confirm(`Make @${m.handle} the owner?`, "They manage the share, and you become an editor.", "Make owner")) void run(() => api.transferShare(share.shareId, m.id), true);
                            }}
                          >
                            Make owner
                          </Button>
                        )}
                        <Button disabled={busy} className="text-danger" onClick={() => void run(() => api.removeMember(share.shareId, m.id))}>
                          Remove
                        </Button>
                      </>
                    ) : (
                      <span className="text-[length:var(--fs-sm)] text-muted">{roleText(m.role)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {owner && (
              <section aria-label="Invite" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="t-label text-muted">Invite as</h3>
                  <Segmented name="shareRole" label="Invite as" value={role} onChange={setRole} options={ROLES} />
                </div>
                {candidates.length > 0 && (
                  <ul className="-mx-2 max-h-44 space-y-px overflow-y-auto">
                    {candidates.map((f) => (
                      <li key={f.id} className="flex min-h-[var(--row)] items-center gap-3 rounded-control px-2 hover:bg-surface-2">
                        <span className="min-w-0 flex-1 truncate">{who(f)}</span>
                        <Button variant="secondary" disabled={busy} onClick={() => void run(() => api.inviteToShare(share.shareId, f.id, role))}>
                          Invite
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => void makeLink()}>
                    Copy invite link
                  </Button>
                  {link && <input readOnly aria-label="Invite link" value={link} onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1" />}
                </div>
              </section>
            )}
          </>
        )}

        <div className="flex items-center gap-2 border-t border-border pt-4">
          {share && owner && (
            <Button className="text-danger" disabled={busy} onClick={() => void stop()}>
              Stop sharing
            </Button>
          )}
          {share && !owner && (
            <Button className="text-danger" disabled={busy} onClick={() => void leave()}>
              Leave
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
}
