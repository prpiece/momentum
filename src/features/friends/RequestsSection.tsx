import { Ban, Flag, MoreHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import * as api from "../../lib/sync/social";
import { useData } from "../../stores/data";
import { useSocial } from "../../stores/social";
import { toast } from "../../stores/toast";
import { confirm, openMenuAt } from "../../stores/ui";
import { ReportAccountDialog } from "./ReportAccountDialog";
import { attempt, who } from "./attempt";

/** Block (and Report, when the sender is a known account) for whoever sent a request, task or invitation (SOC-11). */
function SenderMenu({ sender }: { sender: api.Profile }) {
  const [report, setReport] = useState(false);
  const name = sender.displayName || `@${sender.handle}`;
  const open = (el: HTMLElement) =>
    openMenuAt(el, [
      {
        label: "Block",
        icon: <Ban size={14} />,
        danger: true,
        run: async () => {
          if (await confirm(`Block ${name}?`, "You stop seeing each other, and you are removed from each other's shared lists. You can unblock them later.", "Block")) {
            if (await attempt(() => api.blockAccount(sender.id))) toast(`Blocked ${name}.`);
          }
        },
      },
      { label: "Report…", icon: <Flag size={14} />, danger: true, run: () => setReport(true) },
    ]);
  return (
    <>
      <button type="button" aria-label={`Block or report ${name}`} onClick={(e) => open(e.currentTarget)} className="btn btn-ghost icon-btn size-8 text-muted">
        <MoreHorizontal size={16} />
      </button>
      {report && <ReportAccountDialog friend={{ ...sender, status: "pending", incoming: true, since: "" }} onClose={() => setReport(false)} />}
    </>
  );
}

function Item({ title, detail, sender, onAccept, onDecline }: { title: string; detail?: string; sender?: api.Profile; onAccept: () => void; onDecline: () => void }) {
  return (
    <li className="flex min-h-[var(--row)] flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {detail && <span className="block truncate text-[length:var(--fs-sm)] text-muted">{detail}</span>}
      </span>
      <button type="button" className="btn btn-ghost" onClick={onDecline}>
        Decline
      </button>
      <button type="button" className="btn btn-primary" onClick={onAccept}>
        Accept
      </button>
      {sender && <SenderMenu sender={sender} />}
    </li>
  );
}

/** Friend requests, tasks friends sent you, and share invitations: everything waiting on you. */
export function RequestsSection() {
  const friends = useSocial((s) => s.friends);
  const tasks = useSocial((s) => s.incomingTasks);
  const shares = useSocial((s) => s.shares);
  const lists = useData((s) => s.lists);
  const folders = useData((s) => s.folders);
  const asked = useMemo(() => friends.filter((f) => f.status === "pending" && f.incoming), [friends]);
  const invited = useMemo(() => shares.filter((s) => s.status === "invited"), [shares]);
  if (!asked.length && !tasks.length && !invited.length) return null;

  const shareName = (s: api.Share) => s.name ?? (s.kind === "list" ? lists[s.containerId]?.name : folders[s.containerId]?.name) ?? `a shared ${s.kind}`;
  const owner = (id: string) => friends.find((f) => f.id === id);

  return (
    <section aria-label="Requests">
      <h3 className="t-label mb-2 text-muted">Requests</h3>
      <ul className="overflow-hidden rounded-card border border-border bg-surface [&>li+li]:border-t [&>li+li]:border-border">
        {asked.map((f) => (
          <Item key={f.id} sender={f} title={`${who(f)} wants to be friends`} onAccept={() => void attempt(() => api.respondFriend(f.id, true))} onDecline={() => void attempt(() => api.respondFriend(f.id, false))} />
        ))}
        {tasks.map((t) => {
          const p = t.payload;
          const bits = [`from @${t.sender.handle}`, p.subtasks?.length ? `${p.subtasks.length} subtask${p.subtasks.length === 1 ? "" : "s"}` : "", p.description ? p.description.replace(/\s+/g, " ").slice(0, 80) : ""].filter(Boolean);
          return <Item key={t.id} sender={t.sender} title={p.title} detail={bits.join(" · ")} onAccept={() => void attempt(() => api.respondSentTask(t.id, true), true)} onDecline={() => void attempt(() => api.respondSentTask(t.id, false))} />;
        })}
        {invited.map((s) => (
          <Item
            key={s.shareId}
            sender={owner(s.ownerId)}
            title={`Invitation to ${shareName(s)}`}
            detail={`${owner(s.ownerId) ? `from @${owner(s.ownerId)?.handle} · ` : ""}${s.role === "viewer" ? "view only" : "you can edit"}`}
            onAccept={() => void attempt(() => api.respondShare(s.shareId, true), true)}
            onDecline={() => void attempt(() => api.respondShare(s.shareId, false))}
          />
        ))}
      </ul>
    </section>
  );
}
