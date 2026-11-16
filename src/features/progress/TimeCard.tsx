import { useMemo } from "react";
import { addDaysLocal, formatMinutes, todayLocal } from "../../domain/dates";
import { estimateAccuracy, focusBreakdown, type TimeRow } from "../../domain/timeReport";
import { useData } from "../../stores/data";
import { useFocus } from "../../stores/focus";

const DAYS = 30;

/** Time (FEAT-11): focus by list and tag over 30 days, and how long finished tasks took against their estimate. Plain numbers. */
export function TimeCard() {
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const sessions = useFocus((s) => s.sessions);
  const today = todayLocal();
  const { b, acc } = useMemo(() => {
    const from = addDaysLocal(today, 1 - DAYS);
    const all = Object.values(sessions);
    return { b: focusBreakdown(all, tasks, from, today), acc: estimateAccuracy(all, Object.values(tasks), from, today) };
  }, [sessions, tasks, today]);
  if (b.total === 0 && acc.count === 0) return null;
  return (
    <section className="card" aria-label="Time">
      <div className="card-h flex-wrap justify-start gap-x-3">
        <h3>Time</h3>
        <span className="text-[length:var(--fs-sm)] text-muted">last {DAYS} days</span>
      </div>
      <div className="grid grid-cols-1 gap-6 min-[720px]:grid-cols-2">
        <Rows title="Focus by list" rows={b.byList} name={(id) => lists[id]?.name ?? "Deleted list"} total={b.total} />
        <Rows title="Focus by tag" rows={b.byTag} name={(id) => `#${tags[id]?.name ?? id}`} total={b.total} />
      </div>
      {b.unlinked > 0 && <p className="mt-3 text-[length:var(--fs-sm)] text-muted tabular-nums">{formatMinutes(b.unlinked)} of focus was not on a task.</p>}
      <div className="mt-4 border-t border-border pt-3">
        <h4 className="t-label text-muted">Estimate against actual</h4>
        {acc.median === null ? (
          <p className="text-[length:var(--fs-sm)] text-muted">Finish a task you gave a duration and focused on to compare.</p>
        ) : (
          <p className="text-[length:var(--fs-sm)] tabular-nums">
            {acc.count} finished {acc.count === 1 ? "task" : "tasks"}: planned {formatMinutes(acc.estimated)}, took {formatMinutes(acc.spent)}. Typically {acc.median >= 1 ? `${acc.median.toFixed(1)}x longer than` : `${(1 / acc.median).toFixed(1)}x quicker than`} estimated.
          </p>
        )}
      </div>
    </section>
  );
}

function Rows({ title, rows, name, total }: { title: string; rows: TimeRow[]; name: (id: string) => string; total: number }) {
  return (
    <div>
      <h4 className="t-label mb-2 text-muted">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-[length:var(--fs-sm)] text-muted">None yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.slice(0, 8).map((r) => (
            <li key={r.id} className="grid grid-cols-[1fr_64px_56px] items-center gap-2.5 text-[length:var(--fs-sm)]">
              <span className="truncate">{name(r.id)}</span>
              <span className="bar">
                <span style={{ width: `${Math.round((r.minutes / (total || 1)) * 100)}%` }} />
              </span>
              <span className="text-right tabular-nums text-fg-2">{formatMinutes(r.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
