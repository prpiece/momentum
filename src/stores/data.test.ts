import { beforeEach, describe, expect, it } from "vitest";
import { atLocalTime, timed, wallKey } from "../domain/dates";
import { toVM } from "../domain/taskViews";
import { derive } from "../domain/taskViews";
import {
  addSection,
  addFolder,
  addList,
  addTask,
  deleteOccurrence,
  deleteTasks,
  depthOf,
  duplicateTask,
  ensureTags,
  removeList,
  removeTag,
  updateTag,
  updateList,
  editOccurrence,
  moveSection,
  moveTasks,
  moveFolder,
  removeFolder,
  replaceAll,
  restoreTasks,
  setEditGuard,
  setParent,
  setStatus,
  skipMissed,
  undoable,
  undoableStructure,
  removeSection,
  updateTask,
  useData,
} from "./data";

// Repos are no-ops outside Tauri, so this exercises the store logic alone.
beforeEach(() => replaceAll({ tasks: [], events: [], lists: [], folders: [], sections: [], tags: [] }));
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

  it("finishing a parent finishes its open subtasks; reopening leaves them done", () => {
    const p = addTask({ title: "P" });
    const a = addTask({ title: "A", parentId: p.id });
    const b = addTask({ title: "B", parentId: a.id, status: "wont_do" });
    setStatus(p.id, "done");
    const t = useData.getState().tasks;
    expect([t[a.id].status, t[b.id].status]).toEqual(["done", "wont_do"]);
    setStatus(p.id, "open");
    expect(useData.getState().tasks[a.id].status).toBe("done");
  });

  it("keeps subtasks out of the top-level task set", () => {
    const p = addTask({ title: "P" });
    const c = addTask({ title: "C", parentId: p.id, schedule: { kind: "day", date: "2026-10-31" } });
    const g = addTask({ title: "G", parentId: c.id });
    const { tasks, lists } = useData.getState();
    expect(derive(tasks, lists).roots.map((v) => v.task.id)).toEqual([p.id]);
    expect(derive(tasks, lists).childrenOf(c.id).map((v) => v.task.id)).toEqual([g.id]);
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

describe("moveSection", () => {
  const names = () => Object.values(useData.getState().sections).sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.name);
  it("moves a section to an index among its list's sections, writing one row", () => {
    const [a, b, c] = ["A", "B", "C"].map((n) => addSection("l1", n));
    const other = addSection("l2", "X");
    moveSection(c.id, 0);
    expect(names().filter((n) => n !== "X")).toEqual(["C", "A", "B"]);
    moveSection(c.id, 2);
    expect(names().filter((n) => n !== "X")).toEqual(["A", "B", "C"]);
    expect(useData.getState().sections[a.id].sortOrder).toBe(a.sortOrder);
    expect(useData.getState().sections[other.id].sortOrder).toBe(other.sortOrder);
    expect(useData.getState().sections[b.id].sortOrder).toBe(b.sortOrder);
  });
});

describe("nested folders", () => {
  it("refuses invalid moves and lifts children up when a folder is deleted", () => {
    const a = addFolder("A")!;
    const b = addFolder("B", a.id)!;
    const c = addFolder("C", b.id)!;
    expect(addFolder("D", c.id)).toBeNull();
    expect(moveFolder(a.id, c.id)).toBe(false);
    const l = addList("L", b.id);
    removeFolder(b.id);
    const { folders, lists } = useData.getState();
    expect(folders[b.id]).toBeUndefined();
    expect(folders[c.id].parentId).toBe(a.id);
    expect(lists[l.id].folderId).toBe(a.id);
  });
});

describe("v1.2.1 store fixes", () => {
  it("restoring a subtask restores its trashed parent", () => {
    const p = addTask({ title: "P" });
    const c = addTask({ title: "C", parentId: p.id });
    deleteTasks([p.id]);
    restoreTasks([c.id]);
    expect(live().map((t) => t.id).sort()).toEqual([p.id, c.id].sort());
  });

  it("H10: following and all treat someday like none", () => {
    const mk = () => addTask({ title: "S", schedule: { kind: "day", date: "2026-10-26" }, recurrence: { rule: "FREQ=DAILY", exdates: [] } });
    const a = mk();
    editOccurrence(a.id, "2026-10-28", "following", { schedule: { kind: "someday" } });
    expect(live().filter((t) => t.schedule.kind === "someday").every((t) => t.recurrence === null)).toBe(true);
    const b = mk();
    editOccurrence(b.id, "2026-10-28", "all", { schedule: { kind: "someday" } });
    expect(useData.getState().tasks[b.id].recurrence).toBeNull();
  });

  it("setParent into another list keeps the new parent", () => {
    const p1 = addTask({ title: "P1", listId: "work" });
    const c = addTask({ title: "C", parentId: p1.id, listId: "work" });
    const p2 = addTask({ title: "P2" });
    expect(setParent(c.id, p2.id)).toBe(true);
    expect(useData.getState().tasks[c.id]).toMatchObject({ parentId: p2.id, listId: p2.listId });
  });

  it("depthOf and descendants survive a parent cycle", () => {
    const a = addTask({ title: "A" });
    const b = addTask({ title: "B", parentId: a.id });
    useData.setState((s) => ({ tasks: { ...s.tasks, [a.id]: { ...s.tasks[a.id], parentId: b.id } } }));
    expect(depthOf(a.id)).toBeGreaterThan(0);
    expect(() => deleteTasks([a.id])).not.toThrow();
  });
});

describe("H11 view-only lists", () => {
  it("refuses every task write to a list the guard rejects, whichever path it takes", () => {
    const t = addTask({ title: "Shared", listId: "ro" });
    setEditGuard((id) => id !== "ro");
    try {
      updateTask(t.id, { title: "x" });
      setStatus(t.id, "done");
      deleteTasks([t.id]);
      moveTasks([t.id], "inbox");
      expect(useData.getState().tasks[t.id]).toMatchObject({ title: "Shared", status: "open", deletedAt: null, listId: "ro" });
    } finally {
      setEditGuard(() => true);
    }
  });
});

describe("v1.2.4 store fixes", () => {
  const tasks = () => useData.getState().tasks;

  it("DATA-02: renaming a tag to another tag's name (any case) is refused", () => {
    const [a, b] = ensureTags(["Work", "Home"]);
    expect(updateTag(b, { name: "work" })).toBe(false);
    expect(useData.getState().tags[b].name).toBe("Home");
    expect(updateTag(a, { name: "WORK" })).toBe(true); // its own name, other case
    expect(updateTag(b, { name: "Errands" })).toBe(true);
  });

  it("DATA-04: setParent refuses a trashed parent", () => {
    const p = addTask({ title: "P" });
    const c = addTask({ title: "C" });
    deleteTasks([p.id]);
    expect(setParent(c.id, p.id)).toBe(false);
    expect(tasks()[c.id].parentId).toBeNull();
  });

  it("DATA-05: updateTask and addTask ignore a parent that would make a cycle, exceed the depth, or is missing", () => {
    const a = addTask({ title: "A" });
    const b = addTask({ title: "B", parentId: a.id });
    updateTask(a.id, { parentId: b.id });
    expect(tasks()[a.id].parentId).toBeNull();
    updateTask(a.id, { parentId: a.id });
    expect(tasks()[a.id].parentId).toBeNull();
    updateTask(b.id, { parentId: "ghost" });
    expect(tasks()[b.id].parentId).toBe(a.id);
    let p = a;
    for (let i = 2; i <= 5; i++) p = addTask({ title: `L${i}`, parentId: p.id });
    expect(addTask({ title: "too deep", parentId: p.id }).parentId).toBeNull();
    expect(depthOf(p.id)).toBe(5);
  });

  it("DATA-06: removing a list drops its sections and the cross-list subtasks of its tasks", () => {
    const l = addList("Gone");
    const sec = addSection(l.id, "S");
    const p = addTask({ title: "P", listId: l.id });
    const c = addTask({ title: "C", parentId: p.id, listId: "inbox" }); // lives elsewhere, child of p
    useData.setState((s) => ({ tasks: { ...s.tasks, [c.id]: { ...s.tasks[c.id], listId: "inbox" } } }));
    const keep = addTask({ title: "Keep" });
    removeList(l.id);
    expect(useData.getState().sections[sec.id]).toBeUndefined();
    expect(Object.keys(tasks())).toEqual([keep.id]);
  });

  it("DATA-07: removing a tag also strips it from trashed tasks", () => {
    const [tag] = ensureTags(["x"]);
    const t = addTask({ title: "T", tags: [tag] });
    deleteTasks([t.id]);
    removeTag(tag);
    restoreTasks([t.id]);
    expect(tasks()[t.id].tags).toEqual([]);
  });

  it("DATA-08: duplicating twice gives distinct sort orders, each right after its source", () => {
    const a = addTask({ title: "A", sortOrder: 1 });
    const z = addTask({ title: "Z", sortOrder: 2 });
    const c1 = duplicateTask(a.id)!;
    const c2 = duplicateTask(a.id)!;
    const orders = [a, c2, c1, z].map((t) => tasks()[t.id].sortOrder);
    expect(orders).toEqual([...orders].sort((x, y) => x - y));
    expect(new Set(orders).size).toBe(4);
  });

  it("UI-10: moving a parent and its subtask together keeps them nested, in either order", () => {
    for (const order of [0, 1]) {
      const p = addTask({ title: "P" });
      const c = addTask({ title: "C", parentId: p.id });
      moveTasks(order ? [p.id, c.id] : [c.id, p.id], "work");
      expect(tasks()[c.id]).toMatchObject({ parentId: p.id, listId: "work" });
    }
  });
});

describe("HAB-19 waiting and someday flow down to open subtasks", () => {
  const T = () => useData.getState().tasks;
  const WAIT = { kind: "person", who: "Sam", followUp: "2026-12-01" } as const;
  const tree = () => {
    const p = addTask({ title: "P" });
    const a = addTask({ title: "A", parentId: p.id });
    const b = addTask({ title: "B", parentId: a.id });
    const done = addTask({ title: "Done", parentId: p.id, status: "done" });
    return { p, a, b, done };
  };

  it("a person wait is copied to open subtasks at every depth, not to finished ones; one undo reverts all", () => {
    const { p, a, b, done } = tree();
    const undo = undoable(() => updateTask(p.id, { waiting: WAIT }));
    expect([T()[a.id].waiting, T()[b.id].waiting]).toEqual([WAIT, WAIT]);
    expect(T()[done.id].waiting).toBeNull();
    undo();
    expect([T()[p.id].waiting, T()[a.id].waiting, T()[b.id].waiting]).toEqual([null, null, null]);
  });

  it("clearing on the parent clears identical copies only; a subtask's own wait stays", () => {
    const { p, a, b } = tree();
    updateTask(p.id, { waiting: WAIT });
    const own = { kind: "person", who: "Kim", followUp: "2026-12-05" } as const;
    updateTask(b.id, { waiting: own });
    updateTask(p.id, { waiting: null });
    expect(T()[a.id].waiting).toBeNull();
    expect(T()[b.id].waiting).toEqual(own);
  });

  it("clearing on a subtask touches only that subtask", () => {
    const { p, a, b } = tree();
    updateTask(p.id, { waiting: WAIT });
    updateTask(b.id, { waiting: null });
    expect([T()[p.id].waiting, T()[a.id].waiting, T()[b.id].waiting]).toEqual([WAIT, WAIT, null]);
  });

  it("waiting on a task skips that task and its ancestors and descendants", () => {
    const { p, a, b } = tree();
    const sib = addTask({ title: "Sib", parentId: p.id });
    updateTask(p.id, { waiting: { kind: "task", taskId: a.id } });
    expect(T()[a.id].waiting).toBeNull(); // the blocker itself
    expect(T()[b.id].waiting).toBeNull(); // its descendant
    expect(T()[sib.id].waiting).toEqual({ kind: "task", taskId: a.id });
  });

  it("someday is copied to open subtasks and cleared again only where it is still someday", () => {
    const { p, a, b } = tree();
    updateTask(b.id, { schedule: { kind: "day", date: "2026-12-02" } });
    updateTask(p.id, { schedule: { kind: "someday" } });
    expect([T()[a.id].schedule.kind, T()[b.id].schedule.kind]).toEqual(["someday", "someday"]);
    updateTask(b.id, { schedule: { kind: "day", date: "2026-12-03" } }); // edited on its own
    updateTask(p.id, { schedule: { kind: "none" } });
    expect(T()[a.id].schedule.kind).toBe("none");
    expect(T()[b.id].schedule).toEqual({ kind: "day", date: "2026-12-03" });
  });
});

describe("skipMissed (TIME-20)", () => {
  it("excludes every missed occurrence in one write, which undoes as one step", () => {
    const s = addTask({ title: "Gym", schedule: { kind: "day", date: "2026-11-10" }, recurrence: { rule: "FREQ=DAILY", exdates: [] } });
    let n = 0;
    const revert = undoable(() => void (n = skipMissed(s.id, "2026-11-14")));
    expect(n).toBe(4);
    expect(useData.getState().tasks[s.id].recurrence?.exdates).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(skipMissed(s.id, "2026-11-14")).toBe(0);
    revert();
    expect(useData.getState().tasks[s.id].recurrence?.exdates).toEqual([]);
  });
});

describe("undoableStructure (DATA-15)", () => {
  it("brings back a deleted list with its tasks and sections", () => {
    const l = addList("Work");
    const sec = addSection(l.id, "Doing");
    const t = addTask({ title: "A", listId: l.id, sectionId: sec.id });
    const revert = undoableStructure(() => removeList(l.id));
    expect(useData.getState().lists[l.id]).toBeUndefined();
    expect(useData.getState().tasks[t.id]).toBeUndefined();
    revert();
    expect(useData.getState().lists[l.id]).toBeDefined();
    expect(useData.getState().sections[sec.id]).toBeDefined();
    expect(useData.getState().tasks[t.id].sectionId).toBe(sec.id);
  });

  it("brings back a tag on its tasks, a section's tasks and a folder's lists", () => {
    const [tag] = ensureTags(["x"]);
    const l = addList("L");
    const sec = addSection(l.id, "S");
    const t = addTask({ title: "A", listId: l.id, sectionId: sec.id, tags: [tag] });
    undoableStructure(() => removeTag(tag))();
    expect(useData.getState().tags[tag]).toBeDefined();
    expect(useData.getState().tasks[t.id].tags).toEqual([tag]);
    undoableStructure(() => removeSection(sec.id))();
    expect(useData.getState().tasks[t.id].sectionId).toBe(sec.id);
    const f = addFolder("F")!;
    updateList(l.id, { folderId: f.id });
    undoableStructure(() => removeFolder(f.id))();
    expect(useData.getState().folders[f.id]).toBeDefined();
    expect(useData.getState().lists[l.id].folderId).toBe(f.id);
  });
});

describe("recurring checklists (FEAT-13)", () => {
  it("finished occurrence keeps its ticks, the series starts unticked", () => {
    const s = addTask({ title: "Clean", schedule: { kind: "day", date: "2026-10-25" }, recurrence: { rule: "FREQ=WEEKLY", exdates: [] }, checklist: [{ id: "a", title: "Dust", done: true }] });
    setStatus(s.id, "done");
    expect(useData.getState().tasks[s.id].checklist[0].done).toBe(false);
    expect(live().find((t) => t.status === "done")?.checklist[0].done).toBe(true);
  });
});
