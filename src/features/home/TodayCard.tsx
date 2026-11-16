import { useMemo } from "react";
import { formatTime, todayLocal } from "../../domain/dates";
import { inSmartList, isOverdue, sortVMs } from "../../domain/taskViews";
import { useSettings } from "../../stores/settings";
import { go, openTask } from "../../stores/ui";
import { useDerived } from "../tasks/selectors";
import { HomeCard, Quiet, Row } from "./HomeCard";

const SHOWN = 5;

/** What is on Today: the count, how much is overdue and the first few tasks. Same rule as the Today view. */
export function TodayCard() {
  const derived = useDerived();
  const fmt = useSettings((s) => s.settings.timeFormat);
  const today = todayLocal();
  const { open, overdue } = useMemo(() => {
    const open = sortVMs(derived.active.filter((vm) => inSmartList("today", vm, today)), "date");
    return { open, overdue: open.filter((vm) => isOverdue(vm, today)).length };
  }, [derived, today]);

  return (
    <HomeCard title="Today" onOpen={() => go("today")} className="min-[720px]:col-span-2">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="t-display tabular-nums">{open.length}</span>
        <span className="text-fg-2">{open.length === 1 ? "task to do" : "tasks to do"}</span>
        {overdue > 0 && <span className="text-[length:var(--fs-sm)] font-medium text-danger tabular-nums">{overdue} overdue</span>}
      </div>
      {open.length === 0 ? (
        <Quiet>Nothing planned for today.</Quiet>
      ) : (
        <ul>
          {open.slice(0, SHOWN).map((vm) => (
            <li key={`${vm.task.id}:${vm.key ?? ""}`}>
              <Row onClick={() => openTask(vm.task.id, vm.key)}>
                <span className="size-3.5 shrink-0 rounded-full border-2 border-control-border" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{vm.task.title}</span>
                {vm.schedule.kind === "timed" && <span className="shrink-0 text-muted tabular-nums">{formatTime(new Date(vm.schedule.start), fmt)}</span>}
              </Row>
            </li>
          ))}
        </ul>
      )}
      {open.length > SHOWN && (
        <button type="button" onClick={() => go("today")} className="mt-1 self-start rounded-control px-2 py-1 text-[length:var(--fs-sm)] text-accent-text hover:bg-surface-2">
          {open.length - SHOWN} more in Today
        </button>
      )}
    </HomeCard>
  );
}
