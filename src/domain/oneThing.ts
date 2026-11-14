import { taskMinutes } from "./dates";
import { quadrantOf, type MatrixRules } from "./matrix";
import { inSmartList, type TaskVM } from "./taskViews";
import type { Energy, LocalDate } from "./types";

/** Low energy (D267): only tasks of this many minutes or less. Tasks without a duration count as Normal. */
export const LOW_ENERGY_MAX_MIN = 15;

export const fitsEnergy = (vm: TaskVM, energy: Energy) => {
  if (energy === "normal") return true;
  const min = taskMinutes({ schedule: vm.schedule, durationMin: vm.task.durationMin });
  return min !== null && min <= LOW_ENERGY_MAX_MIN;
};

/**
 * One thing (D267): the single next task of Today. Chosen by Matrix quadrant, then deadline (sooner
 * first, none last), then the order `vms` arrive in (the view's sort). A task planned after today
 * ("Not now") is skipped even when an old deadline keeps it in Today.
 */
export function pickOneThing(vms: readonly TaskVM[], today: LocalDate, rules: MatrixRules, energy: Energy): TaskVM | null {
  let best: { vm: TaskVM; q: number; dl: string; i: number } | null = null;
  vms.forEach((vm, i) => {
    if (!inSmartList("today", vm, today) || (vm.date !== null && vm.date > today) || !fitsEnergy(vm, energy)) return;
    const c = { vm, q: quadrantOf(vm, today, rules), dl: vm.task.deadline ?? "￿", i };
    if (!best || c.q < best.q || (c.q === best.q && (c.dl < best.dl || (c.dl === best.dl && c.i < best.i)))) best = c;
  });
  return (best as { vm: TaskVM } | null)?.vm ?? null;
}
