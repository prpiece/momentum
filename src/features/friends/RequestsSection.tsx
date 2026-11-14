import { useMemo } from "react";
import * as api from "../../lib/sync/social";
import { useData } from "../../stores/data";
import { useSocial } from "../../stores/social";
import { attempt, who } from "./attempt";

function Item({ title, detail, onAccept, onDecline }: { title: string; detail?: string; onAccept: () => void; onDecline: () => void }) {
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
          <Item key={f.id} title={`${who(f)} wants to be friends`} onAccept={() => void attempt(() => api.respondFriend(f.id, true))} onDecline={() => void attempt(() => api.respondFriend(f.id, false))} />
        ))}
        {tasks.map((t) => {
          const p = t.payload;
          const bits = [`from @${t.sender.handle}`, p.subtasks?.length ? `${p.subtasks.length} subtask${p.subtasks.length === 1 ? "" : "s"}` : "", p.description ? p.description.replace(/\s+/g, " ").slice(0, 80) : ""].filter(Boolean);
          return <Item key={t.id} title={p.title} detail={bits.join(" · ")} onAccept={() => void attempt(() => api.respondSentTask(t.id, true), true)} onDecline={() => void attempt(() => api.respondSentTask(t.id, false))} />;
        })}
        {invited.map((s) => (
          <Item
            key={s.shareId}
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
