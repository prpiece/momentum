import { format } from "date-fns";
import { useMemo } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { fromLocalDate, relativeDayLabel, todayLocal } from "../../domain/dates";
import { triagePatch } from "../../domain/planDay";
import { weeklyReview } from "../../domain/review";
import type { TaskVM } from "../../domain/taskViews";
import { deleteTasks, restoreTasks, setStatus, updateTask, useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { openTask, toast } from "../../stores/ui";
import { useDerived } from "../tasks/selectors";

const SHOWN = 8;

/** Weekly review (FEAT-04): checklist sections that are plain selectors over live tasks. Nothing here is stored. */
export function ReviewView() {
  const derived = useDerived();
  const tasks = useData((s) => s.tasks);
  const ws = useSettings((s) => s.settings.weekStart);
  const today = todayLocal();
  const r = useMemo(() => weeklyReview(derived.active, Object.values(tasks), today, ws), [derived, tasks, today, ws]);
  const act = {
    done: (vm: TaskVM) => setStatus(vm.task.id, "done", vm.key),
    tomorrow: (vm: TaskVM) => updateTask(vm.task.id, triagePatch(vm, "tomorrow", today)),
    someday: (vm: TaskVM) => updateTask(vm.task.id, triagePatch(vm, "someday", today)),
    del: (vm: TaskVM) => {
      const ids = deleteTasks([vm.task.id]);
      toast("Moved to Trash", { label: "Undo", run: () => restoreTasks(ids) });
    },
  };
  const week = `${format(fromLocalDate(r.lastWeek.from), "MMM d")} to ${format(fromLocalDate(r.lastWeek.to), "MMM d")}`;
  return (
    <div className="h-full overflow-y-auto px-[var(--gutter)] pb-10 pt-6">
      <div className="mx-auto flex max-w-[860px] flex-col gap-3">
        <PageHead title="Weekly review" sub="Go through each section, then you are clear for the week." />
        <Section title="Overdue" items={r.overdue} empty="Nothing overdue." actions={["done", "tomorrow", "someday", "del"]} act={act} />
        <Section title="Follow-ups due" items={r.followUps} empty="No one to chase." actions={["done", "del"]} act={act} />
        <Section title="Inbox, untouched for 7 days or more" items={r.staleInbox} empty="Inbox is fresh." actions={["done", "tomorrow", "someday", "del"]} act={act} />
        <Section title="Someday" items={r.someday} empty="Nothing parked." actions={["done", "tomorrow", "del"]} act={act} hint="Anything worth doing now?" />
        <section className="card flex items-baseline gap-3">
          <h3 className="text-[length:var(--fs-lg)] font-semibold">Last week</h3>
          <span className="t-count text-[length:var(--fs-xl)] font-semibold tabular-nums">{r.lastWeekDone}</span>
          <span className="text-fg-2">{r.lastWeekDone === 1 ? "task done" : "tasks done"}</span>
          <span className="ml-auto text-[length:var(--fs-sm)] text-muted">{week}</span>
        </section>
        <Section title="Next 7 days" items={r.nextWeek} empty="Nothing planned yet." actions={["done", "tomorrow", "someday"]} act={act} dates={today} />
      </div>
    </div>
  );
}

type Act = "done" | "tomorrow" | "someday" | "del";
const LABEL: Record<Act, string> = { done: "Done", tomorrow: "Tomorrow", someday: "Someday", del: "Delete" };

function Section({ title, items, empty, actions, act, hint, dates }: { title: string; items: TaskVM[]; empty: string; actions: Act[]; act: Record<Act, (vm: TaskVM) => void>; hint?: string; dates?: string }) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-h">
        <h3>{title}</h3>
        <span className="text-[length:var(--fs-sm)] text-muted tabular-nums">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[length:var(--fs-sm)] text-muted">{empty}</p>
      ) : (
        <>
          {hint && <p className="mb-1 text-[length:var(--fs-sm)] text-muted">{hint}</p>}
          <ul>
            {items.slice(0, SHOWN).map((vm) => (
              <li key={`${vm.task.id}:${vm.key ?? ""}`} className="group flex min-h-9 items-center gap-2 rounded-control px-2 hover:bg-surface-2">
                <button type="button" onClick={() => openTask(vm.task.id, vm.key)} className="min-w-0 flex-1 truncate text-left text-[length:var(--fs-sm)]">
                  {vm.task.title}
                </button>
                {dates && vm.date && <span className="shrink-0 text-[length:var(--fs-sm)] text-muted tabular-nums">{relativeDayLabel(vm.date, dates)}</span>}
                <span className="flex shrink-0 gap-1">
                  {actions.map((a) => (
                    <button key={a} type="button" onClick={() => act[a](vm)} className={`btn btn-ghost btn-sm ${a === "del" ? "text-danger" : ""}`}>
                      {LABEL[a]}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {items.length > SHOWN && <p className="mt-1 px-2 text-[length:var(--fs-sm)] text-muted">{items.length - SHOWN} more. Handle these and they will show.</p>}
        </>
      )}
    </section>
  );
}
