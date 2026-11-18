import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Habit } from "../domain/habits";

const trackDone = vi.fn();
vi.mock("../db/client", () => ({ select: async () => [], selectAfterWrites: async () => [], write: async () => undefined, upsert: (t: string) => [t, []] }));
vi.mock("./settings", () => ({ trackDone, useSettings: { getState: () => ({ settings: {} }) } }));

const h = (goal: Habit["goal"]): Habit => ({ id: "h", name: "H", icon: "", color: "", goal, frequency: { kind: "daily" }, reminders: [], groupId: null, sortOrder: 0, archived: false, startDate: "2026-10-20", createdAt: "" });
// The first import transforms the whole store graph (seconds when the machine is busy); do it once here, not inside the first test's 5 s budget
// (a timed-out test keeps running and would leak a trackDone call into the next one).
beforeAll(() => import("./habits"), 60_000);
beforeEach(() => trackDone.mockClear());

it("HAB-07: a check-in before the start date moves the start back", async () => {
  const { useHabits, setCheckin } = await import("./habits");
  useHabits.setState({ habits: { h: h({ kind: "once" }) } });
  setCheckin("h", "2026-10-15", { value: 1 });
  expect(useHabits.getState().habits.h.startDate).toBe("2026-10-15");
  setCheckin("h", "2026-10-18", { value: 1 });
  expect(useHabits.getState().habits.h.startDate).toBe("2026-10-15");
});

it("HAB-10: logging a slip on a quit habit doesn't count as habit:checked", async () => {
  const { useHabits, setCheckin } = await import("./habits");
  useHabits.setState({ habits: { h: h({ kind: "quit" }) }, checkins: {} });
  setCheckin("h", "2026-10-21", { value: 1 });
  expect(trackDone).not.toHaveBeenCalled();
  useHabits.setState({ habits: { h: h({ kind: "once" }) }, checkins: {} });
  setCheckin("h", "2026-10-21", { value: 1 });
  expect(trackDone).toHaveBeenCalledWith("habit:checked");
});

it("SYNC-14: a check-in tapped while hydrateHabits was reading isn't reverted", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  vi.resetModules();
  vi.doMock("../db/client", () => ({ selectAfterWrites: async () => (await held, []), write: async () => undefined, upsert: (t: string) => [t, []] }));
  const { useHabits, hydrateHabits, setCheckin } = await import("./habits");
  useHabits.setState({ habits: { h: h({ kind: "once" }) }, checkins: {} });
  const loading = hydrateHabits();
  await new Promise((r) => setTimeout(r, 0)); // the read is now in flight
  setCheckin("h", "2026-10-21", { value: 1 });
  release();
  await loading;
  expect(useHabits.getState().checkins.h?.["2026-10-21"]?.value).toBe(1);
  vi.doUnmock("../db/client");
});
