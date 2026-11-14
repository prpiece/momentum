import { useMemo, useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { useSync } from "../../lib/sync/engine";
import { sendTask, SocialError, type SentPayload } from "../../lib/sync/social";
import { useData } from "../../stores/data";
import { useSocial } from "../../stores/social";
import { toast } from "../../stores/toast";
import { who } from "./attempt";

/** What goes to the friend: title, note, checklist as JSON text, and the subtasks' titles (D260). Nothing else. */
function payloadOf(taskId: string): SentPayload | null {
  const { tasks } = useData.getState();
  const t = tasks[taskId];
  if (!t) return null;
  const subtasks = Object.values(tasks)
    .filter((x) => x.parentId === taskId && !x.deletedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((x) => ({ title: x.title }));
  return {
    title: t.title,
    ...(t.description.trim() ? { description: t.description } : {}),
    ...(t.checklist.length ? { checklist: JSON.stringify(t.checklist) } : {}),
    ...(subtasks.length ? { subtasks } : {}),
  };
}

export function SendToFriendDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const account = useSync((s) => s.account);
  const all = useSocial((s) => s.friends);
  const friends = useMemo(() => all.filter((f) => f.status === "accepted"), [all]);
  const title = useData((s) => s.tasks[taskId]?.title);
  const [busy, setBusy] = useState<string | null>(null);

  const send = async (id: string, name: string) => {
    const p = payloadOf(taskId);
    if (!p) return;
    setBusy(id);
    try {
      await sendTask(id, p);
      toast(`Sent to ${name}. They choose whether to accept it.`);
      onClose();
    } catch (e) {
      toast(e instanceof SocialError ? e.message : "Couldn't send it. Try again.");
      setBusy(null);
    }
  };

  return (
    <Dialog label="Send to friend" onClose={onClose} width="max-w-md">
      <div className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">Send to friend</h2>
          <p className="mt-0.5 truncate text-[length:var(--fs-sm)] text-muted">“{title}” goes to their Requests. If they accept, it lands in their Inbox as a separate copy.</p>
        </div>
        {!account ? (
          <p className="text-fg-2">Sign in from Settings → Account to send tasks to friends.</p>
        ) : friends.length === 0 ? (
          <p className="text-fg-2">No friends yet. Add one from Friends.</p>
        ) : (
          <ul className="-mx-2 max-h-72 space-y-px overflow-y-auto">
            {friends.map((f) => (
              <li key={f.id} className="flex min-h-[var(--row)] items-center gap-3 rounded-control px-2 hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate">{who(f)}</span>
                <Button variant="secondary" disabled={busy !== null} onClick={() => void send(f.id, `@${f.handle}`)}>
                  {busy === f.id ? "Sending…" : "Send"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
