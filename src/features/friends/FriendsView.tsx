import { Link2, Users } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHead } from "../../components/ui/PageHead";
import { handleFrom, inviteUrl } from "../../domain/invite";
import { useSync } from "../../lib/sync/engine";
import { useServerVersion } from "../../lib/sync/serverVersion";
import * as api from "../../lib/sync/social";
import { openInvite, refreshSocial, useSocial } from "../../stores/social";
import { toast } from "../../stores/toast";
import { openSettingsPage } from "../../stores/settings";
import { go } from "../../stores/ui";
import { BuddiesSection } from "./BuddiesSection";
import { FriendRow } from "./FriendRow";
import { RequestsSection } from "./RequestsSection";
import { ServerUpdateNotice } from "./ServerUpdateNotice";
import { copyText } from "./attempt";

const STATUS = { pending: "Waiting", accepted: "Accepted", declined: "Declined" } as const;

/** Paste a link someone sent you; works signed out too (the code is kept until you sign in). */
function OpenInvite() {
  const [text, setText] = useState("");
  const open = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const r = await openInvite(text);
      toast(
        r === "invalid"
          ? "That doesn't look like a Momentum invite link."
          : r === "saved"
            ? "Saved. It's applied when you sign in."
            : r === "friend"
              ? "You're now friends."
              : "You've been invited to a share. Accept it under Requests.",
      );
      if (r !== "invalid") setText("");
    } catch (err) {
      toast(err instanceof api.SocialError ? err.message : "Couldn't open that link.");
    }
  };
  return (
    <form onSubmit={open} className="flex items-center gap-2">
      <div className="input-wrap min-w-0 flex-1">
        <Link2 size={16} aria-hidden />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste an invite link" aria-label="Open an invite link" />
      </div>
      <button type="submit" className="btn btn-secondary" disabled={!text.trim()}>
        Open
      </button>
    </form>
  );
}

function AddFriend() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const handle = handleFrom(text);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!handle) return;
    setBusy(true);
    try {
      const r = await api.requestFriend(handle);
      toast(r === "pending" ? `Request sent to @${handle}.` : r === "accepted" ? `You and @${handle} are friends now.` : `You're already friends with @${handle}.`);
      setText("");
      await refreshSocial();
    } catch (err) {
      toast(err instanceof api.SocialError ? err.message : "Couldn't send the request.");
    }
    setBusy(false);
  };
  return (
    <form onSubmit={add} className="flex items-center gap-2">
      <div className="input-wrap min-w-0 flex-1">
        <span aria-hidden className="text-muted">@</span>
        <input value={text.replace(/^@/, "")} onChange={(e) => setText(e.target.value)} placeholder="handle" aria-label="Add friend by handle" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={!handle || busy}>
        Add friend
      </button>
    </form>
  );
}

function Signed() {
  const all = useSocial((s) => s.friends);
  const outgoing = useSocial((s) => s.outgoingTasks);
  const loaded = useSocial((s) => s.loaded);
  const friends = useMemo(() => all.filter((f) => f.status === "accepted" || !f.incoming), [all]);
  const behind = useServerVersion((s) => s.state) === "behind";
  // Opening Friends always shows the latest requests, whatever Realtime missed.
  useEffect(() => void refreshSocial(), []);

  const copy = async () => {
    try {
      const url = inviteUrl(await api.createFriendInvite());
      toast((await copyText(url)) ? "Invite link copied. It works for 30 days." : url);
    } catch (e) {
      toast(e instanceof api.SocialError ? e.message : "Couldn't make a link.");
    }
  };

  if (behind)
    return (
      <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-6 px-[var(--gutter)] pb-10 pt-6">
        <PageHead title="Friends" />
        <ServerUpdateNotice />
      </div>
    );

  return (
    <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-6 px-[var(--gutter)] pb-10 pt-6">
      <PageHead title="Friends" sub="Friends see nothing of your tasks unless you send or share them.">
        <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
          <Link2 size={16} strokeWidth={1.75} /> Copy invite link
        </button>
      </PageHead>

      <section aria-label="Add" className="card space-y-3">
        <AddFriend />
        <OpenInvite />
      </section>

      <RequestsSection />

      <section aria-label="Friends">
        <h3 className="t-label mb-2 text-muted">Friends · {friends.length}</h3>
        {friends.length ? (
          <ul className="overflow-hidden rounded-card border border-border bg-surface [&>li+li]:border-t [&>li+li]:border-border">
            {friends.map((f) => (
              <FriendRow key={f.id} friend={f} />
            ))}
          </ul>
        ) : (
          <p className="text-muted">{loaded ? "No friends yet. Add one by handle, or copy your invite link and send it." : "Loading…"}</p>
        )}
      </section>

      <BuddiesSection />

      {outgoing.length > 0 && (
        <section aria-label="Sent tasks">
          <h3 className="t-label mb-2 text-muted">Sent tasks</h3>
          <ul className="overflow-hidden rounded-card border border-border bg-surface [&>li+li]:border-t [&>li+li]:border-border">
            {outgoing.map((o) => (
              <li key={o.id} className="flex min-h-[var(--row)] items-center gap-3 px-3.5">
                <span className="min-w-0 flex-1 truncate">{o.title}</span>
                <span className="shrink-0 text-[length:var(--fs-sm)] text-muted">@{o.handle ?? "friend"}</span>
                <span className="w-20 shrink-0 text-right text-[length:var(--fs-sm)] font-medium">{STATUS[o.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function FriendsView() {
  const account = useSync((s) => s.account);
  if (account) return <Signed />;
  return (
    <EmptyState icon={Users} title="Friends">
      <p>Sign in to add friends, send them tasks, share lists and focus together.</p>
      <div className="mx-auto mt-4 max-w-sm space-y-3">
        <button type="button" className="btn btn-primary" onClick={() => (openSettingsPage("settings-account"), go("settings"))}>
          Open Settings → Account
        </button>
        <OpenInvite />
      </div>
    </EmptyState>
  );
}
