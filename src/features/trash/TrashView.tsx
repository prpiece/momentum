import { formatDistanceToNowStrict } from "date-fns";
import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHead } from "../../components/ui/PageHead";
import { trashItems, TRASH_DAYS } from "../../domain/trash";
import { purgeTasks, restoreTasks, useData } from "../../stores/data";
import { confirm, toast } from "../../stores/ui";

/** Trash (D287): deleted tasks wait here for 30 days. Restore brings back the task with its subtasks (and a trashed parent). */
export function TrashView() {
  const tasks = useData((s) => s.tasks);
  const items = useMemo(() => trashItems(tasks, Date.now()), [tasks]);
  if (!items.length)
    return (
      <EmptyState icon={Trash2} title="Trash is empty">
        Deleted tasks wait here for {TRASH_DAYS} days before they&rsquo;re gone for good.
      </EmptyState>
    );
  return (
    <div className="h-full overflow-y-auto px-[var(--gutter)] pb-10 pt-6">
      <div className="mb-4">
        <PageHead title="Trash" sub={`Deleted tasks are removed after ${TRASH_DAYS} days.`} />
      </div>
      <ul className="card divide-y divide-border">
        {items.map(({ task, ids, daysLeft }) => (
          <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate">{task.title}{ids.length > 1 && <span className="text-muted"> + {ids.length - 1} subtasks</span>}</div>
              <div className="text-[length:var(--fs-sm)] text-muted tabular-nums">
                Deleted {formatDistanceToNowStrict(new Date(task.deletedAt!), { addSuffix: true })} · {daysLeft} {daysLeft === 1 ? "day" : "days"} left
              </div>
            </div>
            <Button variant="secondary" onClick={() => (restoreTasks(ids), toast(`Restored “${task.title}”`))}>
              Restore
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirm(`Delete “${task.title}” forever?`, "This can't be undone.", "Delete forever")) purgeTasks(ids);
              }}
            >
              Delete forever
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
