import { Check, Sunrise } from "lucide-react";
import { addDaysLocal, formatMinutes, moveToDate, relativeDayLabel, taskMinutes, todayLocal } from "../../domain/dates";
import { pickOneThing } from "../../domain/oneThing";
import { scheduleForKey } from "../../domain/recurrence";
import type { TaskVM } from "../../domain/taskViews";
import { ENERGIES, type Energy } from "../../domain/types";
import { useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { openTask } from "../../stores/ui";
import { editTask, toggleDone } from "./actions";

const ENERGY_LABEL: Record<Energy, string> = { normal: "Normal", low: "Low" };

/** Today as a single task (D267): Done, or Not now (tomorrow). No counts or streaks. */
export function OneThing({ vms }: { vms: readonly TaskVM[] }) {
  const rules = useSettings((s) => s.settings.matrix);
  const energy = useSettings((s) => s.settings.oneThing.energy);
  const lists = useData((s) => s.lists);
  const today = todayLocal();
  const vm = pickOneThing(vms, today, rules, energy);
  const setEnergy = (e: Energy) => useSettings.getState().update({ oneThing: { ...useSettings.getState().settings.oneThing, energy: e } });
  const notNow = (v: TaskVM) => {
    const from = v.key ? scheduleForKey(v.task.schedule, v.key) : v.task.schedule;
    void editTask(v.task.id, { schedule: moveToDate(from, addDaysLocal(today, 1)) }, v.key);
  };
  const minutes = vm && taskMinutes({ schedule: vm.schedule, durationMin: vm.task.durationMin });

  return (
    <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-col items-center gap-6 px-[var(--gutter)] py-10">
      <div role="radiogroup" aria-label="Energy" className="seg">
        {ENERGIES.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={energy === e} onClick={() => setEnergy(e)} className={`seg-item ${energy === e ? "is-on" : ""}`}>
            {ENERGY_LABEL[e]} energy
          </button>
        ))}
      </div>
      {vm ? (
        <div className="card flex w-full max-w-lg flex-col items-center gap-3 p-8 text-center">
          <button type="button" onClick={() => openTask(vm.task.id, vm.key)} className="rounded-control text-[length:var(--fs-xl)] font-semibold text-fg hover:text-accent-text">
            {vm.task.title}
          </button>
          <p className="text-sm text-muted tabular-nums">
            {[lists[vm.task.listId]?.name, vm.task.deadline && `by ${relativeDayLabel(vm.task.deadline, today)}`, minutes && formatMinutes(minutes)].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => toggleDone(vm.task.id, vm.key)} className="btn btn-primary">
              <Check size={16} /> Done
            </button>
            <button type="button" onClick={() => notNow(vm)} className="btn btn-secondary">
              <Sunrise size={16} /> Not now
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">{energy === "low" ? "Nothing of 15 minutes or less today. Give tasks a duration, like “15m”." : "Nothing left for today."}</p>
      )}
    </div>
  );
}
