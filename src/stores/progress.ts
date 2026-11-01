import { create } from "zustand";
import { select, write } from "../db/client";
import { isLocalDate, todayLocal } from "../domain/dates";
import type { Push } from "../domain/perfect";
import type { LocalDate } from "../domain/types";

/** Rest days, played celebrations and pushed-off tasks: what perfect days need besides tasks and habits (D64). */
type State = { restDays: ReadonlySet<LocalDate>; celebrated: ReadonlySet<string>; pushes: readonly Push[]; ready: boolean };
export const useProgress = create<State>(() => ({ restDays: new Set(), celebrated: new Set(), pushes: [], ready: false }));
const set = useProgress.setState;

const PUSH = /^(\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})$/;

export async function hydrateProgress() {
  const [rest, done, moves] = await Promise.all([
    select<{ date: unknown }>("SELECT date FROM rest_days"),
    select<{ key: unknown }>("SELECT key FROM celebrations"),
    select<{ at: unknown; detail: unknown }>("SELECT at, detail FROM task_activity WHERE kind = 'scheduled' AND detail <> ''"),
  ]);
  const pushes: Push[] = [];
  for (const m of moves) {
    const hit = typeof m.detail === "string" ? PUSH.exec(m.detail) : null;
    if (!hit || typeof m.at !== "string") continue;
    const on = todayLocal(new Date(m.at));
    if (hit[2] > hit[1] && on >= hit[1]) pushes.push({ on, from: hit[1], to: hit[2] });
  }
  set({
    restDays: new Set(rest.map((r) => r.date).filter(isLocalDate)),
    celebrated: new Set(done.map((r) => r.key).filter((k): k is string => typeof k === "string")),
    pushes,
    ready: true,
  });
}

/** A task moved later: only "pushed off" when it happens on or after its due day. */
export function notePush(from: LocalDate, to: LocalDate) {
  const on = todayLocal();
  if (on >= from) set((s) => ({ pushes: [...s.pushes, { on, from, to }] }));
}

export function setRestDay(date: LocalDate, rest: boolean) {
  set((s) => {
    const next = new Set(s.restDays);
    if (rest) next.add(date);
    else next.delete(date);
    return { restDays: next };
  });
  void write(rest ? ["INSERT OR IGNORE INTO rest_days (date) VALUES ($1)", [date]] : ["DELETE FROM rest_days WHERE date = $1", [date]]);
}

/** Marks celebrations as played; returns the keys that hadn't been. */
export function markCelebrated(keys: string[]): string[] {
  const seen = useProgress.getState().celebrated;
  const fresh = keys.filter((k) => !seen.has(k));
  if (!fresh.length) return fresh;
  set((s) => ({ celebrated: new Set([...s.celebrated, ...fresh]) }));
  const at = new Date().toISOString();
  void write(...fresh.map((k): [string, unknown[]] => ["INSERT OR IGNORE INTO celebrations (key, at) VALUES ($1, $2)", [k, at]]));
  return fresh;
}
