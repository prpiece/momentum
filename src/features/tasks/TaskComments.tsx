import { formatDistanceToNowStrict } from "date-fns";
import { useCallback, useEffect, useState } from "react";
import { bestRole, sharesCoveringList } from "../../domain/shareAccess";
import { useServerVersion } from "../../lib/sync/serverVersion";
import { addTaskComment, deleteTaskComment, editTaskComment, SocialError, taskComments, type TaskComment } from "../../lib/sync/social";
import { useSync } from "../../lib/sync/engine";
import { useData } from "../../stores/data";
import { useSocial } from "../../stores/social";
import { toast } from "../../stores/ui";
import type { Task } from "../../domain/types";

/** The thread on a task in a shared list (FEAT-14). Online only; nothing renders for a private task or a signed-out account. */
export function TaskComments({ task }: { task: Task }) {
  const account = useSync((s) => s.account);
  const lists = useData((s) => s.lists);
  const folders = useData((s) => s.folders);
  const shares = useSocial((s) => s.shares);
  const behind = useServerVersion((s) => s.state === "behind");
  const list = lists[task.listId];
  const role = list ? bestRole(sharesCoveringList(shares, folders, list)) : null;
  if (!account || !role || behind) return null;
  return <Thread taskId={task.id} canWrite={role !== "viewer"} />;
}

function Thread({ taskId, canWrite }: { taskId: string; canWrite: boolean }) {
  const [items, setItems] = useState<TaskComment[] | null>(null);
  // A ping refreshes the social store, which replaces `shares`: that is the cue to reload (and a 3-minute poll backs it).
  const pinged = useSocial((s) => s.shares);
  const load = useCallback(() => taskComments(taskId).then(setItems, () => undefined), [taskId]);
  useEffect(() => void load(), [load, pinged]);
  const run = (p: Promise<void>) => p.then(load, (e) => toast(e instanceof SocialError ? e.message : "Couldn't do that. Try again."));

  return (
    <details className="mt-3" open>
      <summary className="t-label cursor-pointer rounded-xs pl-0.5 text-muted hover:text-fg">Comments{items?.length ? ` · ${items.length}` : ""}</summary>
      <ul className="mt-2 space-y-3">
        {(items ?? []).map((c) => (
          <Comment key={c.commentId} c={c} onSave={(b) => run(editTaskComment(c.commentId, b))} onDelete={() => run(deleteTaskComment(c.commentId))} canWrite={canWrite} />
        ))}
      </ul>
      {items?.length === 0 && <p className="mt-2 pl-0.5 text-[length:var(--fs-sm)] text-muted">No comments yet.</p>}
      {canWrite && <Composer onSend={(b) => addTaskComment(taskId, b).then(load)} />}
    </details>
  );
}

function Comment({ c, canWrite, onSave, onDelete }: { c: TaskComment; canWrite: boolean; onSave: (b: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const link = "rounded-xs text-muted hover:text-fg";
  return (
    <li className="pl-0.5 text-[length:var(--fs-sm)]">
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{c.displayName || `@${c.handle}`}</span>
        <time dateTime={c.createdAt} className="tabular-nums text-muted">{formatDistanceToNowStrict(new Date(c.createdAt), { addSuffix: true })}</time>
        {c.editedAt && <span className="text-muted">edited</span>}
        {c.mine && !editing && (
          <span className="ml-auto flex gap-3">
            {canWrite && <button className={link} onClick={() => { setDraft(c.body); setEditing(true); }}>Edit</button>}
            <button className={link} onClick={() => void onDelete()}>Delete</button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-1 space-y-2">
          <textarea className="input w-full" rows={2} maxLength={4000} value={draft} autoFocus aria-label="Edit comment" onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} />
          <div className="flex gap-2">
            <button className="btn" disabled={!draft.trim()} onClick={() => void onSave(draft).then(() => setEditing(false))}>Save</button>
            <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
      )}
    </li>
  );
}

function Composer({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSend(text);
      setText("");
    } catch (e) {
      toast(e instanceof SocialError ? e.message : "Couldn't post the comment. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 space-y-2">
      <textarea className="input w-full" rows={2} maxLength={4000} placeholder="Write a comment" aria-label="New comment" value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
      <button className="btn btn-primary" disabled={!text.trim() || busy} onClick={() => void send()}>Comment</button>
    </div>
  );
}
