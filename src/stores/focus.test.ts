import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TaskVM } from "../domain/taskViews";

const writes: [string, unknown[]?][] = [];
let stored: string | null = null;
vi.mock("../db/client", () => ({
  select: async (sql: string) => (sql.includes("sync_state") ? (stored ? [{ value: stored }] : []) : []),
  write: async (...st: [string, unknown[]?][]) => void writes.push(...st),
  upsert: (table: string, row: Record<string, unknown>) => [`UPSERT ${table}`, [row]] as [string, unknown[]],
}));

const min = 60_000;
const t0 = Date.parse("2026-10-25T14:00:00.000Z");
beforeEach(() => (vi.useFakeTimers(), vi.setSystemTime(t0), (writes.length = 0), (stored = null), vi.resetModules()));
afterEach(() => vi.useRealTimers());

it("HAB-01: a running timer is mirrored to storage and recorded up to its last save on next launch", async () => {
  const a = await import("./focus");
  a.startFocus("stopwatch", "A");
  vi.setSystemTime(t0 + 90 * min);
  a.tickFocus(); // heartbeat
  const save = writes.filter(([sql]) => sql.startsWith("INSERT INTO sync_state")).slice(-1)[0];
  stored = save[1]![1] as string;
  // app restarts: fresh module, idle timer
  vi.resetModules();
  const b = await import("./focus");
  await b.hydrateFocus();
  const [s] = Object.values(b.useFocus.getState().sessions);
  expect(s).toMatchObject({ taskId: "A", mode: "stopwatch", seconds: 90 * 60 });
  expect(b.useFocus.getState().timer.status).toBe("idle");
  expect(writes.some(([sql]) => sql.startsWith("DELETE FROM sync_state"))).toBe(true);
});

it("HAB-01: stopping clears the stored timer; a garbage value is dropped", async () => {
  const a = await import("./focus");
  a.startFocus("stopwatch", "A");
  a.stopFocus();
  expect(writes[writes.length - 1][0]).toMatch(/^DELETE FROM sync_state/);
  stored = "{nope";
  vi.spyOn(console, "error").mockImplementation(() => {});
  await a.hydrateFocus();
  expect(Object.keys(a.useFocus.getState().sessions)).toHaveLength(0);
});

it("HAB-04: switching task mid-stopwatch keeps the earlier time on the old task", async () => {
  const f = await import("./focus");
  f.startFocus("stopwatch", "A");
  vi.setSystemTime(t0 + 59 * min);
  f.setFocusTask("B");
  vi.setSystemTime(t0 + 61 * min);
  f.stopFocus();
  const byTask = Object.fromEntries(Object.values(f.useFocus.getState().sessions).map((s) => [s.taskId, s.seconds]));
  expect(byTask).toEqual({ A: 59 * 60, B: 2 * 60 });
});

it("HAB-14: stopping manually forgets the block end so a later manual start isn't cut off", async () => {
  const f = await import("./focus");
  const { useSettings } = await import("./settings");
  useSettings.setState({ settings: { ...useSettings.getState().settings, autoFocus: true } });
  const block = { task: { id: "A", title: "A", status: "open" }, schedule: { kind: "timed", start: new Date(t0).toISOString(), end: new Date(t0 + 30 * min).toISOString() }, date: null, key: null } as unknown as TaskVM;
  expect(f.autoStartFocus(() => [block], t0 + 1000)?.taskId).toBe("A");
  f.stopFocus();
  f.startFocus("stopwatch", "A");
  f.autoStartFocus(() => [block], t0 + 31 * min);
  expect(f.useFocus.getState().timer.status).toBe("running");
});

it("HAB-05: a stopwatch doesn't count the time the machine slept", async () => {
  const f = await import("./focus");
  f.startFocus("stopwatch", "A");
  vi.setSystemTime(t0 + 10 * min);
  f.tickFocus();
  vi.setSystemTime(t0 + 9 * 60 * min); // woke 9 h later
  f.tickFocus();
  expect(f.useFocus.getState().timer.status).toBe("paused");
  f.resumeFocus();
  f.stopFocus();
  expect(Object.values(f.useFocus.getState().sessions)[0]?.seconds).toBe(10 * 60);
});
