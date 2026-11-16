import { BookOpen } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHead } from "../../components/ui/PageHead";
import { relativeDayLabel, todayLocal } from "../../domain/dates";
import { logbook } from "../../domain/logbook";
import { setStatus, useData } from "../../stores/data";
import { openTask } from "../../stores/ui";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";

const PAGE = 200;

/** Logbook (FEAT-17): everything you finished, by day. A view over tasks, so Progress is unaffected and nothing syncs differently. */
export function LogbookView() {
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const query = useDeferredValue(q);
  const today = todayLocal();
  const { days, total } = useMemo(() => logbook(Object.values(tasks), query, limit), [tasks, query, limit]);
  const shown = days.reduce((n, d) => n + d.tasks.length, 0);
  if (total === 0 && !query)
    return (
      <EmptyState icon={BookOpen} title="Nothing finished yet">
        Tasks you complete show up here, by day.
      </EmptyState>
    );
  return (
    <div className="h-full overflow-y-auto px-[var(--gutter)] pb-10 pt-6">
      <div className="mx-auto flex max-w-[860px] flex-col gap-4">
        <PageHead title="Logbook" sub={`${total} finished ${total === 1 ? "task" : "tasks"}`}>
          <input className="input w-56" type="search" aria-label="Search the logbook" placeholder="Search finished tasks" value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} />
        </PageHead>
        {days.length === 0 && <p className="text-muted">No finished task matches “{query}”.</p>}
        {days.map((d) => (
          <section key={d.day} aria-label={d.day}>
            <h3 className="t-label mb-1 text-muted">
              {relativeDayLabel(d.day, today)} <span className="tabular-nums">{d.tasks.length}</span>
            </h3>
            <ul className="card divide-y divide-border p-0">
              {d.tasks.map((t) => (
                <li key={t.id} className="flex min-h-9 items-center gap-2.5 px-3 py-1">
                  <TaskCheckbox status={t.status} priority={t.priority} label={`Reopen ${t.title}`} onToggle={() => setStatus(t.id, "open")} />
                  <button type="button" onClick={() => openTask(t.id)} className="min-w-0 flex-1 truncate text-left text-fg-2">
                    {t.title}
                  </button>
                  <span className="shrink-0 text-[length:var(--fs-sm)] text-muted">{lists[t.listId]?.name}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {shown < total && (
          <button type="button" className="btn btn-secondary self-center" onClick={() => setLimit((l) => l + PAGE)}>
            Show more
          </button>
        )}
      </div>
    </div>
  );
}
