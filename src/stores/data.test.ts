import { beforeEach, describe, expect, it } from "vitest";
import { atLocalTime, timed, wallKey } from "../domain/dates";
import { toVM } from "../domain/taskViews";
import {
  addTask,
  deleteOccurrence,
  deleteTasks,
  editOccurrence,
  replaceAll,
  restoreTasks,
  setParent,
  setStatus,
  undoable,
  updateTask,
  useData,
} from "./data";

// Repos are no-ops outside Tauri, so this exercises the store logic alone.
beforeEach(() => replaceAll({ tasks: [], lists: [], folders: [], sections: [], tags: [] }));
const live = () => Object.values(useData.getState().tasks).filter((t) => !t.deletedAt);

describe("recurring completion", () => {
  it("detaches the current occurrence as a done task and advances the series", () => {
    const s = addTask({ title: "Gym", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY", exdates: [] } });
    setStatus(s.id, "done");
    const series = useData.getState().tasks[s.id];
    expect(toVM(series)?.date).toBe("2026-10-26");
    const done = live().find((t) => t.status === "done");
    expect(done).toMatchObject({ recurrence: null, recurrenceParentId: s.id, schedule: { kind: "day", date: "2026-10-25" } });
  });

  it("retires a series when its last occurrence is completed", () => {
    const s = addTask({ title: "Once more", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY;COUNT=1", exdates: [] } });
    setStatus(s.id, "done");
    expect(useData.getState().tasks[s.id].deletedAt).not.toBeNull();
    expect(live()).toHaveLength(1);
  });
});

describe("scope edits", () => {
  const series = () =>
    addTask({ title: "Standup", schedule: timed(atLocalTime("2026-10-26", "09:00"), 15), recurrence: { rule: "FREQ=DAILY", exdates: [] } });

  it("this: moves one occurrence only", () => {
    const s = series();
    editOccurrence(s.id, "2026-10-28T09:00", "this", { schedule: timed(atLocalTime("2026-10-28", "11:00"), 15) });
    expect(useData.getState().tasks[s.id].recurrence?.exdates).toEqual(["2026-10-28T09:00"]);
    const single = live().find((t) => t.id !== s.id);
    expect(single?.schedule.kind === "timed" && wallKey(new Date(single.schedule.start))).toBe("2026-10-28T11:00");
  });

  it("following: splits into two series", () => {
    const s = series();
    editOccurrence(s.id, "2026-10-28T09:00", "following", { title: "Sync" });
    expect(live().map((t) => t.title).sort()).toEqual(["Standup", "Sync"]);
    expect(useData.getState().tasks[s.id].recurrence?.rule).toContain("UNTIL=");
  });

  it("all: shifts the anchor by the moved amount", () => {
    const s = series();
    editOccurrence(s.id, "2026-10-28T09:00", "all", { schedule: timed(atLocalTime("2026-10-29", "10:30"), 15) });
    const t = useData.getState().tasks[s.id];
    expect(t.schedule.kind === "timed" && wallKey(new Date(t.schedule.start))).toBe("2026-10-27T10:30");
  });

  it("delete this occurrence only adds an exdate", () => {
    const s = series();
    deleteOccurrence(s.id, "2026-10-26T09:00", "this");
    expect(toVM(useData.getState().tasks[s.id])?.key).toBe("2026-10-27T09:00");
  });
});

describe("subtasks", () => {
  it("enforces the 5-level depth limit and refuses cycles", () => {
    let parent = addTask({ title: "L1" });
    const root = parent;
    for (let i = 2; i <= 5; i++) parent = addTask({ title: `L${i}`, parentId: parent.id });
    const extra = addTask({ title: "L6" });
    expect(setParent(extra.id, parent.id)).toBe(false);
    expect(setParent(root.id, parent.id)).toBe(false);
  });

  it("moves subtasks with their parent and soft-deletes them together", () => {
    const p = addTask({ title: "P" });
    const c = addTask({ title: "C", parentId: p.id });
    updateTask(p.id, { listId: "work" });
    expect(useData.getState().tasks[c.id].listId).toBe("work");
    const ids = deleteTasks([p.id]);
    expect(ids.sort()).toEqual([p.id, c.id].sort());
    expect(live()).toHaveLength(0);
    restoreTasks(ids);
    expect(live()).toHaveLength(2);
  });
});

describe("undoable", () => {
  it("reverts edits and removes created tasks", () => {
    const a = addTask({ title: "A" });
    const revert = undoable(() => {
      updateTask(a.id, { title: "A2" });
      addTask({ title: "B" });
    });
    expect(live().map((t) => t.title).sort()).toEqual(["A2", "B"]);
    revert();
    expect(live().map((t) => t.title)).toEqual(["A"]);
  });

  it("undoes a recurring completion completely", () => {
    const s = addTask({ title: "R", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=DAILY", exdates: [] } });
    const revert = undoable(() => setStatus(s.id, "done"));
    revert();
    expect(live()).toHaveLength(1);
    expect(useData.getState().tasks[s.id].recurrence?.exdates).toEqual([]);
  });
});
