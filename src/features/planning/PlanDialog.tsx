import { type ReactNode, useMemo, useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { formatMinutes, taskMinutes, todayLocal } from "../../domain/dates";
import { overdueTasks, pickCandidates, shutdownSummary, todayPlan, triagePatch, type Triage } from "../../domain/planDay";
import type { TaskVM } from "../../domain/taskViews";
import { setStatus, updateTask, useData } from "../../stores/data";
import { useFocus } from "../../stores/focus";
import { go, openPlanning, openTask, useUi } from "../../stores/ui";
import { useDerived } from "../tasks/selectors";
import { TriageList } from "./TriageList";

const ESTIMATES = [15, 30, 60, 90];

function triage(vm: TaskVM, a: Triage, today: string, keepMoves: boolean) {
  if (a === "drop") return setStatus(vm.task.id, "wont_do");
  if (a === "keep" && !keepMoves) return;
  updateTask(vm.task.id, triagePatch(vm, a, today));
}

/** Plan my day / Shut down (FEAT-03): optional, no scores. The rules are in domain/planDay.ts. */
export function PlanDialog() {
  const mode = useUi((s) => s.planning);
  if (!mode) return null;
  return (
    <Dialog label={mode === "plan" ? "Plan my day" : "Shut down"} onClose={() => openPlanning(null)}>
      <div className="flex flex-col gap-4 p-5">{mode === "plan" ? <Plan /> : <Shutdown />}</div>
    </Dialog>
  );
}

function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <header>
      <h2 className="text-[length:var(--fs-lg)] font-semibold">{title}</h2>
      {sub && <p className="text-[length:var(--fs-sm)] text-muted">{sub}</p>}
    </header>
  );
}

const Done = ({ text, action }: { text: string; action: ReactNode }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-fg-2">{text}</span>
    {action}
  </div>
);

function Plan() {
  const derived = useDerived();
  const today = todayLocal();
  const [step, setStep] = useState(0);
  // Fixed when the dialog opens, so a task you handle doesn't vanish from under its step.
  const [overdue] = useState(() => overdueTasks(derived.active, today));
  const [candidates] = useState(() => pickCandidates(derived.active, today));
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const plan = useMemo(() => todayPlan(derived.active, today), [derived, today]);
  const first = overdue.length > 0 ? 0 : 1;
  const at = Math.max(step, first);
  const footer = (
    <div className="border-t border-border pt-3 text-[length:var(--fs-sm)] text-muted tabular-nums">
      {formatMinutes(plan.minutes)} planned{plan.unestimated > 0 && `, ${plan.unestimated} without an estimate`}
    </div>
  );

  if (at === 0)
    return (
      <>
        <Header title="Plan my day" sub="Step 1 of 3: what is left over" />
        <TriageList items={overdue} keepLabel="Today" onAct={(vm, a) => triage(vm, a, today, true)} onDone={<Done text="All sorted." action={<Button variant="primary" onClick={() => setStep(1)}>Next</Button>} />} />
        <Button variant="ghost" onClick={() => setStep(1)}>Skip</Button>
        {footer}
      </>
    );
  if (at === 1)
    return (
      <>
        <Header title="Plan my day" sub="Step 2 of 3: pick what goes on today" />
        {candidates.length === 0 ? (
          <p className="text-muted">Nothing else to pull in.</p>
        ) : (
          <ul className="max-h-[40vh] overflow-y-auto">
            {candidates.map((vm) => (
              <li key={vm.task.id}>
                <label className="flex min-h-9 items-center gap-2.5 rounded-control px-2 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={picked.has(vm.task.id)}
                    onChange={(e) => {
                      const on = e.target.checked;
                      updateTask(vm.task.id, { schedule: on ? triagePatch(vm, "keep", today).schedule : vm.schedule });
                      setPicked((p) => {
                        const n = new Set(p);
                        if (on) n.add(vm.task.id);
                        else n.delete(vm.task.id);
                        return n;
                      });
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{vm.task.title}</span>
                  <span className="text-[length:var(--fs-sm)] text-muted tabular-nums">{vm.date ?? "no date"}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => setStep(2)}>Next</Button>
        </div>
        {footer}
      </>
    );
  return (
    <>
      <Header title="Plan my day" sub="Step 3 of 3: how long will each take" />
      {plan.vms.length === 0 ? (
        <p className="text-muted">Today is empty.</p>
      ) : (
        <ul className="max-h-[40vh] overflow-y-auto">
          {plan.vms.map((vm) => {
            const min = taskMinutes({ schedule: vm.schedule, durationMin: vm.task.durationMin });
            return (
              <li key={`${vm.task.id}:${vm.key ?? ""}`} className="flex min-h-9 items-center gap-2 px-2">
                <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => openTask(vm.task.id, vm.key)}>
                  {vm.task.title}
                </button>
                {vm.schedule.kind === "timed" || vm.task.recurrence ? (
                  <span className="text-[length:var(--fs-sm)] text-muted tabular-nums">{min ? formatMinutes(min) : ""}</span>
                ) : (
                  <span className="seg" role="group" aria-label={`Estimate for ${vm.task.title}`}>
                    {ESTIMATES.map((m) => (
                      <button key={m} type="button" className={`seg-item ${min === m ? "is-on" : ""}`} aria-pressed={min === m} onClick={() => updateTask(vm.task.id, { durationMin: m })}>
                        {formatMinutes(m)}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => (openPlanning(null), go("calendar"))}>Time-block in Calendar</Button>
        <Button variant="primary" onClick={() => openPlanning(null)}>Done</Button>
      </div>
      {footer}
    </>
  );
}

function Shutdown() {
  const derived = useDerived();
  const tasks = useData((s) => s.tasks);
  const sessions = useFocus((s) => s.sessions);
  const today = todayLocal();
  const sum = useMemo(() => shutdownSummary(Object.values(tasks), Object.values(sessions), derived.active, today), [tasks, sessions, derived, today]);
  const [sweep] = useState(() => sum.left); // fixed on open, so the sweep isn't reshuffled while you work through it
  return (
    <>
      <Header title="Shut down" sub="Wrap up today" />
      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <div className="t-label text-muted">Done today</div>
          <div className="text-[length:var(--fs-xl)] font-semibold tabular-nums">{sum.done.length}</div>
        </div>
        <div className="card">
          <div className="t-label text-muted">Focus</div>
          <div className="text-[length:var(--fs-xl)] font-semibold tabular-nums">{formatMinutes(sum.focusMinutes)}</div>
        </div>
      </div>
      {sum.done.length > 0 && (
        <ul className="max-h-24 overflow-y-auto text-[length:var(--fs-sm)] text-fg-2">
          {sum.done.map((t) => (
            <li key={t.id} className="truncate">{t.title}</li>
          ))}
        </ul>
      )}
      <TriageList
        items={sweep}
        keepLabel="Leave"
        onAct={(vm, a) => triage(vm, a, today, false)}
        onDone={<Done text={sweep.length ? "Everything is sorted." : "Nothing left open today."} action={<Button variant="primary" onClick={() => openPlanning(null)}>Close</Button>} />}
      />
    </>
  );
}
