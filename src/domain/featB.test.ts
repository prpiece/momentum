import { describe, expect, it } from "vitest";
import { logbook } from "./logbook";
import { overdueTasks, pickCandidates, shutdownSummary, todayPlan, triagePatch } from "./planDay";
import { weeklyReview } from "./review";
import { snippet } from "./searchExtra";
import { estimateAccuracy, focusBreakdown } from "./timeReport";
import { toVM, type TaskVM } from "./taskViews";
import type { Task } from "./types";

const TODAY = "2026-10-28"; // a Wednesday
let n = 0;
function mk(p: Partial<Task> = {}): Task {
  n++;
  return { id: `t${n}`, title: `Task ${n}`, description: "", listId: "inbox", parentId: null, sectionId: null, status: "open", priority: 0, schedule: { kind: "none" }, recurrence: null, deadline: null, durationMin: null, waiting: null, recurrenceParentId: null, tags: [], checklist: [], reminders: [], sortOrder: n, pinned: false, createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z", completedAt: null, deletedAt: null, ...p };
}
const day = (date: string) => ({ kind: "day", date }) as const;
const vms = (ts: Task[]) => ts.map((t) => toVM(t)!) as TaskVM[];
const at = (d: string) => new Date(`${d}T15:00:00`).toISOString();

describe("plan my day", () => {
  it("lists overdue, offers upcoming and undated, and totals today", () => {
    const over = mk({ schedule: day("2026-10-20"), durationMin: 30 });
    const rec = mk({ schedule: day("2026-10-20"), recurrence: { rule: "FREQ=DAILY", exdates: [], tz: null } });
    const today = mk({ schedule: day(TODAY), durationMin: 90 });
    const soon = mk({ schedule: day("2026-10-30") });
    const far = mk({ schedule: day("2026-12-30") });
    const loose = mk();
    const some = mk({ schedule: { kind: "someday" } });
    const all = vms([over, rec, today, soon, far, loose, some]);
    expect(overdueTasks(all, TODAY).map((v) => v.task.id)).toEqual([over.id]);
    expect(pickCandidates(all, TODAY).map((v) => v.task.id)).toEqual([soon.id, loose.id]);
    const plan = todayPlan(all, TODAY);
    expect(plan.minutes).toBe(120); // the overdue 30m task is in Today too
    expect(plan.unestimated).toBe(plan.vms.length - 2);
  });
  it("triage patches", () => {
    const [v] = vms([mk({ schedule: day("2026-10-20") })]);
    expect(triagePatch(v, "keep", TODAY).schedule).toEqual(day(TODAY));
    expect(triagePatch(v, "tomorrow", TODAY).schedule).toEqual(day("2026-10-29"));
    expect(triagePatch(v, "someday", TODAY).schedule).toEqual({ kind: "someday" });
  });
  it("shut down counts what finished today and what is left", () => {
    const done = mk({ status: "done", completedAt: at(TODAY) });
    const old = mk({ status: "done", completedAt: at("2026-10-27") });
    const left = mk({ schedule: day(TODAY) });
    const s = shutdownSummary([done, old, left], [{ startAt: at(TODAY), seconds: 1800 }], vms([left]), TODAY);
    expect(s.done.map((t) => t.id)).toEqual([done.id]);
    expect(s.focusMinutes).toBe(30);
    expect(s.left.map((v) => v.task.id)).toEqual([left.id]);
  });
});

describe("weekly review", () => {
  it("fills each section", () => {
    const over = mk({ schedule: day("2026-10-20") });
    const stale = mk({ createdAt: "2026-10-10T00:00:00.000Z" });
    const fresh = mk({ createdAt: "2026-10-27T00:00:00.000Z" });
    const wait = mk({ waiting: { kind: "person", who: "sam", followUp: "2026-10-27" } });
    const some = mk({ schedule: { kind: "someday" } });
    const next = mk({ schedule: day("2026-11-02") });
    const done = mk({ status: "done", completedAt: at("2026-10-22") });
    const r = weeklyReview(vms([over, stale, fresh, wait, some, next]), [done], TODAY, 1);
    expect(r.overdue.map((v) => v.task.id)).toEqual([over.id]);
    expect(r.staleInbox.map((v) => v.task.id)).toContain(stale.id);
    expect(r.staleInbox.map((v) => v.task.id)).not.toContain(fresh.id);
    expect(r.followUps.map((v) => v.task.id)).toEqual([wait.id]);
    expect(r.someday).toHaveLength(1);
    expect(r.nextWeek.map((v) => v.task.id)).toEqual([next.id]);
    expect(r.lastWeek).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(r.lastWeekDone).toBe(1);
  });
});

describe("time report", () => {
  const a = mk({ listId: "L1", tags: ["x", "y"], status: "done", completedAt: at(TODAY), durationMin: 30 });
  const b = mk({ listId: "L2", status: "done", completedAt: at(TODAY), durationMin: 10 });
  const sessions = [
    { taskId: a.id, startAt: at(TODAY), seconds: 3600 },
    { taskId: b.id, startAt: at(TODAY), seconds: 600 },
    { taskId: null, startAt: at(TODAY), seconds: 600 },
  ];
  it("splits by list and tag", () => {
    const r = focusBreakdown(sessions, { [a.id]: a, [b.id]: b }, TODAY, TODAY);
    expect(r.total).toBeCloseTo(80);
    expect(r.unlinked).toBeCloseTo(10);
    expect(r.byList).toEqual([{ id: "L1", minutes: 60 }, { id: "L2", minutes: 10 }]);
    expect(r.byTag.map((t) => t.id)).toEqual(["x", "y"]);
  });
  it("median of actual over estimate", () => {
    const r = estimateAccuracy(sessions, [a, b], TODAY, TODAY);
    expect(r.count).toBe(2);
    expect(r.median).toBeCloseTo(1.5); // ratios 2 and 1
  });
});

describe("logbook and snippet", () => {
  it("groups finished tasks by day, newest first, and filters", () => {
    const t1 = mk({ title: "alpha", status: "done", completedAt: at("2026-10-27") });
    const t2 = mk({ title: "beta", status: "done", completedAt: at(TODAY) });
    const t3 = mk({ title: "gamma", status: "wont_do", completedAt: at(TODAY) });
    mk({ title: "open" });
    const r = logbook([t1, t2, t3], "");
    expect(r.days.map((d) => d.day)).toEqual([TODAY, "2026-10-27"]);
    expect(r.days[0].tasks).toHaveLength(2);
    expect(logbook([t1, t2, t3], "alp").total).toBe(1);
  });
  it("snippets around the hit", () => {
    expect(snippet("a very long note about the quarterly budget review and more words after it", "budget")).toContain("budget");
    expect(snippet("short", "zzz")).toBeNull();
  });
});
