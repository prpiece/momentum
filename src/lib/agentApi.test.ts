import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { todayLocal } from "../domain/dates";
import { MAX_SUBTASK_DEPTH } from "../domain/types";
import { addList, addTask, replaceAll, setEditGuard, updateList, useData } from "../stores/data";
import { replaceHabits, setCheckin } from "../stores/habits";
import { answerAgentRequest, runAgentRequest as run } from "./agentApi";

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
    const t = addTask({ title: "Once more", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY;COUNT=1", exdates: [], tz: null } });
    const r = call("complete", { id: t.id });
    expect(r.task).toMatchObject({ title: "Once more", status: "done" });
  });
  it("scope this (default) completes only the current occurrence", () => {
    const s = addTask({ title: "Stretch", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY", exdates: [], tz: null } });
    call("complete", { id: s.id });
    expect(useData.getState().tasks[s.id].status).toBe("open");
    expect(useData.getState().tasks[s.id].recurrence?.exdates).toEqual(["2026-10-25"]);
  });
  it("scope all ends the series, so no more occurrences come (AGENT-17)", () => {
    const s = addTask({ title: "Stretch", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY", exdates: [], tz: null } });
    const r = call("complete", { id: s.id, scope: "all" });
    expect(r.task).toMatchObject({ title: "Stretch", status: "done" });
    expect(useData.getState().tasks[s.id].status).toBe("done");
    expect(live().filter((t) => t.status === "open")).toHaveLength(0);
  });
  it("scope following behaves like all", () => {
    const s = addTask({ title: "Stretch", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY", exdates: [], tz: null } });
    call("complete", { id: s.id, scope: "following" });
    expect(useData.getState().tasks[s.id].status).toBe("done");
  });
});

describe("update on a recurring task", () => {
  const series = () => addTask({ title: "Gym", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY", exdates: [], tz: null } });
  it("changes only this occurrence by default", () => {
    const s = series();
    const r = call("update", { id: s.id, title: "Gym (light)" });
    expect(r.task.id).not.toBe(s.id);
    expect(useData.getState().tasks[s.id].title).toBe("Gym");
  });
  it("keeps the current occurrence's date when only the duration changes (AGENT-02)", () => {
    const timedSeries = () => {
      const t = addTask({ title: "Run", schedule: { kind: "timed", start: "2026-10-01T13:00:00.000Z", end: "2026-10-01T14:00:00.000Z" }, recurrence: { rule: "FREQ=DAILY", exdates: ["2026-10-01T09:00", "2026-10-02T09:00"], tz: null } });
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
    const t = addTask({ title: "Spent", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY;COUNT=1", exdates: ["2026-10-25"], tz: null } });
    expect(() => run("get", { id: t.id })).toThrow(/no occurrences left/);
  });
  it("says so when nothing matches", () => {
    expect(() => run("get", { id: "deadbeef" })).toThrow(/No task with id deadbeef/);
  });
});

describe("delete on a recurring task (AGENT-04)", () => {
  const series = () => addTask({ title: "Tuesdays", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY", exdates: [], tz: null } });
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

describe("recurrence info, archived lists, structured add (AGENT-15/17/19)", () => {
  it("says whether a task is an occurrence and of which series", () => {
    const t = addTask({ title: "Weekly", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=WEEKLY;COUNT=5", exdates: [], tz: null } });
    expect(call("get", { id: t.id }).task).toMatchObject({ isOccurrence: true, seriesId: t.id });
    const plain = call("add", { text: "plain" }).task;
    expect(plain).toMatchObject({ isOccurrence: false, seriesId: null, archived: false });
    run("complete", { id: t.id });
    const done = Object.values(useData.getState().tasks).find((x) => x.recurrenceParentId === t.id);
    expect(call("get", { id: done?.id }).task).toMatchObject({ isOccurrence: true, seriesId: t.id });
  });
  it("adds with structured fields and a time block, and updates the time and pin", () => {
    const r = call("add", { text: "dentist", date: "2026-12-01", time: "14:30", durationMin: 45, priority: "high", tags: ["health"], deadline: "2026-12-02" });
    expect(r.task).toMatchObject({ planned: "2026-12-01", start: "14:30", durationMin: 45, priority: "high", tags: ["health"], deadline: "2026-12-02" });
    const u = call("update", { id: r.task.id, time: "09:00", pinned: true });
    expect(u.task).toMatchObject({ start: "09:00", durationMin: 45, planned: "2026-12-01" });
    expect(Object.values(useData.getState().tasks).find((x) => x.id === r.task.id)?.pinned).toBe(true);
  });
  it("updates repeat, reminders and checklist, and refuses what doesn't fit", () => {
    const t = call("add", { text: "water plants", date: "2026-12-01" }).task;
    const get = () => useData.getState().tasks[t.id];
    expect(() => run("update", { id: t.id, repeat: "FREQ=NOPE" })).toThrow(/RRULE/);
    expect(() => run("update", { id: t.id, reminders: [{ minutes: 10 }] })).toThrow(/time block/);
    run("update", { id: t.id, repeat: "FREQ=WEEKLY;BYDAY=MO", reminders: [{ daysBefore: 1, time: "09:00" }], checklist: ["fill can", "water"] });
    expect(get().recurrence).toEqual({ rule: "FREQ=WEEKLY;BYDAY=MO", exdates: [], tz: null });
    expect(get().reminders).toEqual([{ kind: "dayOf", daysBefore: 1, time: "09:00" }]);
    expect(get().checklist.map((i) => i.title)).toEqual(["fill can", "water"]);
    expect(() => run("update", { id: t.id, repeat: "none" })).toThrow(/scope/);
    run("update", { id: t.id, repeat: "none", scope: "all", checklist: [] });
    expect(get().recurrence).toBeNull();
    expect(get().checklist).toEqual([]);
    const u = call("add", { text: "undated" }).task;
    expect(() => run("update", { id: u.id, repeat: "FREQ=DAILY" })).toThrow(/planned day/);
  });
  it("moves a task under a parent with the loop and depth checks", () => {
    const a = call("add", { text: "A" }).task;
    const b = call("add", { text: "B", parentId: a.id }).task;
    const c = call("add", { text: "C" }).task;
    expect(() => run("update", { id: a.id, parentId: b.id })).toThrow(/loop/);
    run("update", { id: c.id, parentId: a.id });
    expect(useData.getState().tasks[c.id].parentId).toBe(a.id);
    run("update", { id: c.id, parentId: "none" });
    expect(useData.getState().tasks[c.id].parentId).toBeNull();
    let id = call("add", { text: "level 1" }).task.id;
    for (let i = 2; i <= MAX_SUBTASK_DEPTH; i++) id = call("add", { text: `level ${i}`, parentId: id }).task.id;
    expect(() => run("update", { id: c.id, parentId: id })).toThrow(/deeper/);
    expect(useData.getState().tasks[c.id].parentId).toBeNull();
  });
  it("hides tasks of archived lists from list and search unless asked", () => {
    const l = addList("Old");
    const t = call("add", { text: "old thing", list: "Old" }).task;
    expect((run("search", { text: "old thing" }) as { total: number }).total).toBe(1);
    updateList(l.id, { archived: true });
    expect((run("search", { text: "old thing" }) as { total: number }).total).toBe(0);
    expect((run("list", { view: "Old" }) as { total: number }).total).toBe(0);
    const all = run("search", { text: "old thing", includeArchived: true }) as { tasks: { id: string; archived: boolean }[] };
    expect(all.tasks[0]).toMatchObject({ id: t.id, archived: true });
    expect((run("list", { view: "Old", includeArchived: true }) as { total: number }).total).toBe(1);
  });
});

describe("habit check-ins, events, focus, revision (AGENT-20/21)", () => {
  const habit = (id: string, goal: unknown) => ({ id, name: id === "h1" ? "Read" : "Water", icon: "", color: "", goal, frequency: { kind: "daily" }, reminders: [], groupId: null, sortOrder: 0, archived: false, startDate: "2020-01-01", createdAt: "2020-01-01T00:00:00.000Z" }) as never;
  it("checks in, counts and undoes", () => {
    replaceHabits({ habits: [habit("h1", { kind: "once" }), habit("h2", { kind: "count", target: 3, unit: "glasses", period: "day" })], groups: [], checkins: [] });
    expect(run("checkin", { habit: "read" })).toMatchObject({ checkin: 1, habit: { done: true } });
    expect(run("checkin", { habit: "Read", delta: -1 })).toMatchObject({ checkin: 0, habit: { done: false } });
    run("checkin", { habit: "water", delta: 2 });
    expect(run("checkin", { habit: "water" })).toMatchObject({ checkin: 3, habit: { done: true } });
    expect(run("checkin", { habit: "water", value: 0 })).toMatchObject({ checkin: 0 });
    expect(() => run("checkin", { habit: "nope" })).toThrow(/No habit/);
    expect(() => run("checkin", { habit: "read", date: "2999-01-01" })).toThrow(/future/);
  });
  it("lists calendar events and reports an idle timer", () => {
    replaceAll({ tasks: [], events: [{ id: "e1", title: "Standup", notes: "", schedule: { kind: "day", date: "2026-12-03" }, spanDays: 1, color: null, recurrence: null, recurrenceParentId: null, source: "local", subscriptionId: null, countdown: null, pinned: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null } as never], lists: [], folders: [], sections: [], tags: [] });
    expect(run("events", { from: "2026-12-01", to: "2026-12-07" })).toMatchObject({ total: 1, events: [{ title: "Standup", date: "2026-12-03", allDay: true }] });
    expect(run("events", { from: "2026-12-04", to: "2026-12-07" })).toMatchObject({ total: 0 });
    expect(run("focus", {})).toMatchObject({ status: "idle" });
  });
  it("counts changes so a client can see the data moved", async () => {
    const { agentRevision } = await import("./agentApi");
    const before = agentRevision();
    call("add", { text: "x" });
    expect(agentRevision()).toBeGreaterThan(before);
  });
});

describe("view-only lists", () => {
  const MSG = /shared with you as view-only/;
  afterEach(() => setEditGuard(() => true));
  function setup() {
    const ro = addList("Shared");
    const rw = addList("Mine");
    const inRo = addTask({ title: "Theirs", listId: ro.id });
    const inRw = addTask({ title: "Mine", listId: rw.id });
    setEditGuard((id) => id !== ro.id);
    return { ro, rw, inRo, inRw, snap: () => JSON.stringify(useData.getState().tasks) };
  }
  it("refuses update, complete, reopen, delete and subtask-add on a view-only task, changing nothing", () => {
    const { inRo, snap } = setup();
    const before = snap();
    for (const [op, args] of [["update", { id: inRo.id, title: "x" }], ["complete", { id: inRo.id }], ["reopen", { id: inRo.id }], ["delete", { id: inRo.id }], ["add", { text: "sub", parentId: inRo.id }]] as const)
      expect(() => run(op, args), op).toThrow(MSG);
    expect(snap()).toBe(before);
  });
  it("refuses add into, and moves into or out of, a view-only list", () => {
    const { inRw, inRo, snap } = setup();
    const before = snap();
    expect(() => run("add", { text: "new", list: "Shared" })).toThrow(MSG);
    expect(() => run("update", { id: inRw.id, list: "Shared" })).toThrow(MSG);
    expect(() => run("update", { id: inRo.id, list: "Mine" })).toThrow(MSG);
    expect(snap()).toBe(before);
  });
  it("refuses an add whose ~List token (or default) lands in a view-only list, but not an editable one", () => {
    const { snap } = setup();
    const before = snap();
    expect(() => run("add", { text: "~Shared sneaky" })).toThrow(MSG);
    expect(snap()).toBe(before);
    expect(call("add", { text: "~Mine fine" }).task.title).toBe("fine");
  });
  it("refuses restore of a trashed task from a view-only list", () => {
    const ro = addList("Shared");
    const t = addTask({ title: "Gone", listId: ro.id });
    run("delete", { id: t.id });
    setEditGuard((id) => id !== ro.id);
    expect(() => run("restore", { id: t.id })).toThrow(MSG);
    expect(useData.getState().tasks[t.id].deletedAt).not.toBeNull();
  });
  it("still works on editable lists", () => {
    const { inRw } = setup();
    expect(call("update", { id: inRw.id, title: "Renamed" }).task.title).toBe("Renamed");
    expect(call("add", { text: "new", list: "Mine" }).task.title).toBe("new");
  });
});

describe("agent:request nonce", () => {
  const req = { id: "r1", op: "add", args: { text: "spoofed" } };
  it("ignores a request with a missing or wrong nonce, and runs one with the right nonce", () => {
    expect(answerAgentRequest(req, "secret")).toBeNull();
    expect(answerAgentRequest({ ...req, nonce: "guess" }, "secret")).toBeNull();
    expect(answerAgentRequest({ ...req, nonce: "secret" }, null)).toBeNull();
    expect(answerAgentRequest({ ...req, nonce: "" }, "")).toBeNull();
    expect(live()).toHaveLength(0);
    const out = answerAgentRequest({ ...req, nonce: "secret" }, "secret");
    expect(JSON.parse(out ?? "{}").ok).toBe(true);
    expect(live()).toHaveLength(1);
  });
});

describe("spent repeat rules and event ranges", () => {
  it("refuses an expired repeat rule up front and leaves the task as it was", () => {
    const t = addTask({ title: "Plain", schedule: { kind: "day", date: "2026-10-25" } });
    const before = JSON.stringify(useData.getState().tasks);
    for (const repeat of ["FREQ=DAILY;UNTIL=20200101", "FREQ=DAILY;COUNT=0"]) expect(() => run("update", { id: t.id, repeat }), repeat).toThrow(/no occurrence/);
    expect(JSON.stringify(useData.getState().tasks)).toBe(before);
    expect(call("get", { id: t.id }).task.title).toBe("Plain");
    expect(() => run("update", { id: t.id, repeat: "FREQ=DAILY" })).not.toThrow();
  });
  it("rejects events with only a `to` before today", () => {
    expect(() => run("events", { to: "2000-01-01" })).toThrow(/to is before from/);
  });
});
