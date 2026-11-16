import { beforeEach, describe, expect, it } from "vitest";
import { todayLocal } from "../domain/dates";
import { MAX_SUBTASK_DEPTH } from "../domain/types";
import { addTask, replaceAll, useData } from "../stores/data";
import { replaceHabits, setCheckin } from "../stores/habits";
import { runAgentRequest as run } from "./agentApi";

// Repos are no-ops outside Tauri, so this runs the agent ops against the real stores.
beforeEach(() => {
  replaceAll({ tasks: [], events: [], lists: [], folders: [], sections: [], tags: [] });
  replaceHabits({ habits: [], groups: [], checkins: [] });
});
const live = () => Object.values(useData.getState().tasks).filter((t) => !t.deletedAt);
type Res = { task: { id: string; title: string; tags: string[]; planned: string | null }; subtasks: { id: string }[] };
const call = (op: string, args: unknown) => run(op, args) as Res;

describe("add", () => {
  it("lists the tags it just created", () => {
    expect(call("add", { text: "call mom #family" }).task.tags).toEqual(["family"]);
  });
  it("refuses a subtask past MAX_SUBTASK_DEPTH", () => {
    let id = call("add", { text: "level 1" }).task.id;
    for (let i = 2; i <= MAX_SUBTASK_DEPTH; i++) id = call("add", { text: `level ${i}`, parentId: id }).task.id;
    expect(() => run("add", { text: "too deep", parentId: id })).toThrow(/levels deep/);
  });
});

describe("complete", () => {
  it("returns the finished occurrence when it was the last one", () => {
    const t = addTask({ title: "Once more", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY;COUNT=1", exdates: [] } });
    const r = call("complete", { id: t.id });
    expect(r.task).toMatchObject({ title: "Once more", status: "done" });
  });
});

describe("update on a recurring task", () => {
  const series = () => addTask({ title: "Gym", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY", exdates: [] } });
  it("changes only this occurrence by default", () => {
    const s = series();
    const r = call("update", { id: s.id, title: "Gym (light)" });
    expect(r.task.id).not.toBe(s.id);
    expect(useData.getState().tasks[s.id].title).toBe("Gym");
  });
  it("keeps the current occurrence's date when only the duration changes (AGENT-02)", () => {
    const timedSeries = () => {
      const t = addTask({ title: "Run", schedule: { kind: "timed", start: "2026-10-01T13:00:00.000Z", end: "2026-10-01T14:00:00.000Z" }, recurrence: { rule: "FREQ=DAILY", exdates: ["2026-10-01T09:00", "2026-10-02T09:00"] } });
      return t;
    };
    const startOf = (id: string) => {
      const s = useData.getState().tasks[id].schedule;
      return s.kind === "timed" ? [s.start, s.end] : [];
    };
    const one = timedSeries();
    const r = call("update", { id: one.id, durationMin: 30 });
    expect(startOf(r.task.id)).toEqual(["2026-10-03T13:00:00.000Z", "2026-10-03T13:30:00.000Z"]);
    const all = timedSeries();
    call("update", { id: all.id, durationMin: 30, scope: "all" });
    expect(startOf(all.id)).toEqual(["2026-10-01T13:00:00.000Z", "2026-10-01T13:30:00.000Z"]);
  });
  it("changes the whole series with scope all", () => {
    const s = series();
    call("update", { id: s.id, title: "Swim", scope: "all" });
    expect(useData.getState().tasks[s.id].title).toBe("Swim");
    expect(live()).toHaveLength(1);
  });
});

describe("tags on update", () => {
  it("resolves work and Work to one tag", () => {
    const t = addTask({ title: "x" });
    call("update", { id: t.id, tags: ["work", "Work"] });
    expect(useData.getState().tasks[t.id].tags).toHaveLength(1);
  });
});

describe("delete, restore, trash", () => {
  it("deletes by full id, returns the task, and restores it", () => {
    const t = addTask({ title: "Old" });
    const d = run("delete", { id: t.id }) as { deleted: { id: string; title: string } };
    expect(d.deleted).toMatchObject({ id: t.id, title: "Old" });
    expect(live()).toHaveLength(0);
    expect((run("trash", {}) as { total: number }).total).toBe(1);
    expect(call("restore", { id: t.id.slice(0, 6) }).task.title).toBe("Old");
    expect(live()).toHaveLength(1);
  });
  it("refuses a prefix, and a task with subtasks unless withSubtasks", () => {
    const p = addTask({ title: "Parent" });
    addTask({ title: "Kid", parentId: p.id });
    expect(() => run("delete", { id: p.id.slice(0, 6) })).toThrow(/full id/);
    expect(() => run("delete", { id: p.id })).toThrow(/withSubtasks/);
    expect(live()).toHaveLength(2);
    const d = run("delete", { id: p.id, withSubtasks: true }) as { subtasks: { title: string }[] };
    expect(d.subtasks.map((s) => s.title)).toEqual(["Kid"]);
    expect(live()).toHaveLength(0);
    call("restore", { id: p.id });
    expect(live()).toHaveLength(2);
  });
  it("has no bulk delete", () => {
    expect(() => run("delete", { ids: ["a", "b"] })).toThrow(/Unknown field/);
  });
});

describe("find explains a miss (AGENT-01/03)", () => {
  it("says a trashed task is in the Trash", () => {
    const t = addTask({ title: "Gone" });
    run("delete", { id: t.id });
    expect(() => run("get", { id: t.id })).toThrow(/in the Trash.*restore_task/);
    expect(() => run("get", { id: t.id.slice(0, 6) })).toThrow(/in the Trash/);
  });
  it("says an exhausted series has no occurrences left", () => {
    const t = addTask({ title: "Spent", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY;COUNT=1", exdates: ["2026-10-25"] } });
    expect(() => run("get", { id: t.id })).toThrow(/no occurrences left/);
  });
  it("says so when nothing matches", () => {
    expect(() => run("get", { id: "deadbeef" })).toThrow(/No task with id deadbeef/);
  });
});

describe("delete on a recurring task (AGENT-04)", () => {
  const series = () => addTask({ title: "Tuesdays", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY", exdates: [] } });
  it("removes only the current occurrence by default, the series with scope all", () => {
    const s = series();
    const d = run("delete", { id: s.id }) as { deleted: { planned: string; repeats: string } };
    expect(d.deleted.planned).toBe("2026-10-25");
    expect(useData.getState().tasks[s.id].deletedAt).toBeNull();
    expect(call("get", { id: s.id }).task.planned).toBe("2026-10-26");
    run("delete", { id: s.id, scope: "all" });
    expect(useData.getState().tasks[s.id].deletedAt).not.toBeNull();
  });
});

describe("lookups (AGENT-18)", () => {
  it("lists lists and tags, and search can filter by status", () => {
    addTask({ title: "a #x" });
    call("add", { text: "b #family" });
    const tags = (run("tags", {}) as { tags: { name: string }[] }).tags.map((t) => t.name);
    expect(tags).toContain("family");
    expect((run("lists", {}) as { lists: { name: string }[] }).lists.map((l) => l.name)).toContain("Inbox");
    const t = call("add", { text: "finish report" });
    call("complete", { id: t.task.id });
    expect((run("search", { text: "report", status: "open" }) as { total: number }).total).toBe(0);
    expect((run("search", { text: "report", status: "done" }) as { total: number }).total).toBe(1);
  });
});

describe("habits", () => {
  it("reports a weekly goal's week total, not just today", () => {
    const today = todayLocal();
    replaceHabits({
      habits: [{ id: "h1", name: "Run", icon: "", color: "", goal: { kind: "count", target: 3, unit: "runs", period: "week" }, frequency: { kind: "daily" }, reminders: [], groupId: null, sortOrder: 0, archived: false, startDate: "2020-01-01", createdAt: "2020-01-01T00:00:00.000Z" }],
      groups: [],
      checkins: [],
    });
    setCheckin("h1", today, { value: 2 });
    const h = (run("habits", {}) as { habits: { value: number; period: string }[] }).habits[0];
    expect(h).toMatchObject({ value: 2, period: "week" });
  });
});
