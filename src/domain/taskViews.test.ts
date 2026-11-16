import { describe, expect, it } from "vitest";
import { addDaysLocal, atLocalTime, setDayEndHour, timed } from "./dates";
import { derive, doneWindowDays, hiddenAsOld, flattenTree, groupVMs, topLevelIn, inSmartList, inSmartScope, isOverdue, matchScore, plannedMinutes, sortVMs, toVM, type TaskVM } from "./taskViews";
import type { Schedule, SmartListId, Task, TaskList } from "./types";

const TODAY = "2026-10-25";
let n = 0;
function mk(p: Partial<Task> = {}): Task {
  n++;
  return {
    id: `t${n}`,
    title: `Task ${n}`,
    description: "",
    listId: "inbox",
    parentId: null,
    sectionId: null,
    status: "open",
    priority: 0,
    schedule: { kind: "none" },
    recurrence: null,
    deadline: null,
    durationMin: null,
    waiting: null,
    recurrenceParentId: null,
    tags: [],
    checklist: [],
    reminders: [],
    sortOrder: n,
    pinned: false,
    createdAt: `2026-10-0${(n % 9) + 1}T00:00:00.000Z`,
    updatedAt: "2026-10-01T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
    ...p,
  };
}
const vm = (t: Task) => toVM(t) as TaskVM;
const day = (date: string): Schedule => ({ kind: "day", date });
const lists = (...ids: SmartListId[]) => (t: Task) => ids.filter((id) => inSmartList(id, vm(t), TODAY));

describe("smart lists", () => {
  it("classifies by date, status, priority and list", () => {
    expect(lists("today", "upcoming")(mk({ schedule: day("2026-10-24") }))).toEqual(["today"]);
    expect(isOverdue(vm(mk({ schedule: day("2026-10-24") })), TODAY)).toBe(true);
    expect(lists("today", "upcoming")(mk({ schedule: day("2026-10-25") }))).toEqual(["today"]);
    expect(lists("today", "upcoming")(mk({ schedule: day("2026-10-26") }))).toEqual(["upcoming"]);
    expect(lists("upcoming")(mk({ schedule: day("2027-03-01") }))).toEqual(["upcoming"]);
    expect(lists("today", "upcoming", "inbox")(mk())).toEqual(["inbox"]);
    expect(lists("inbox")(mk({ listId: "work" }))).toEqual([]);
  });

  it("keeps finished tasks out of the open smart lists", () => {
    const all: SmartListId[] = ["inbox", "today", "upcoming"];
    expect(lists(...all)(mk({ status: "done", priority: 3, schedule: day(TODAY) }))).toEqual([]);
    expect(lists(...all)(mk({ status: "wont_do" }))).toEqual([]);
    expect(isOverdue(vm(mk({ status: "done", schedule: day("2026-10-01") })), TODAY)).toBe(false);
  });

  it("Today's completed scope respects the end-of-day hour", () => {
    setDayEndHour(3);
    try {
      const at = (hhmm: string) => atLocalTime(TODAY, hhmm).toISOString();
      expect(inSmartScope("today", vm(mk({ status: "done", completedAt: at("01:00") })), TODAY)).toBe(false);
      expect(inSmartScope("today", vm(mk({ status: "done", completedAt: at("04:00") })), TODAY)).toBe(true);
      expect(inSmartScope("today", vm(mk({ status: "done", completedAt: atLocalTime(addDaysLocal(TODAY, 1), "01:00").toISOString() })), TODAY)).toBe(true);
    } finally {
      setDayEndHour(0);
    }
  });

  it("scopes finished tasks for Show completed", () => {
    const scope = (t: Task) => (["inbox", "today", "upcoming"] as const).filter((id) => inSmartScope(id, vm(t), TODAY));
    const doneToday = atLocalTime(TODAY, "09:00").toISOString();
    const doneYesterday = atLocalTime("2026-10-24", "09:00").toISOString();
    expect(scope(mk({ status: "done", completedAt: doneToday, schedule: day("2026-10-01") }))).toEqual(["inbox", "today"]);
    expect(scope(mk({ status: "done", completedAt: doneYesterday, listId: "work" }))).toEqual([]);
    expect(scope(mk({ status: "wont_do", completedAt: doneYesterday, listId: "work", schedule: day("2026-11-02") }))).toEqual(["upcoming"]);
    expect(scope(mk({ listId: "work", schedule: day(TODAY) }))).toEqual(["today"]);
  });

  it("dates timed tasks by their local start day", () => {
    expect(lists("today")(mk({ schedule: timed(atLocalTime(TODAY, "23:30"), 60) }))).toEqual(["today"]);
  });

  it("uses the current occurrence of a recurring task", () => {
    const t = mk({ schedule: day("2026-10-20"), recurrence: { rule: "FREQ=DAILY", exdates: ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"], tz: null } });
    expect(vm(t).date).toBe(TODAY);
    expect(lists("today")(t)).toEqual(["today"]);
    expect(isOverdue(vm(t), TODAY)).toBe(false);
  });
});

describe("sorting", () => {
  it("sorts by date with all-day before timed, undated last, done last, pinned first", () => {
    const a = mk({ title: "timed", schedule: timed(atLocalTime(TODAY, "09:00"), 30) });
    const b = mk({ title: "allday", schedule: day(TODAY) });
    const c = mk({ title: "undated" });
    const d = mk({ title: "done", status: "done", schedule: day("2026-01-01") });
    const e = mk({ title: "pinned", pinned: true });
    expect(sortVMs([a, b, c, d, e].map(vm), "date").map((v) => v.task.title)).toEqual([
      "pinned",
      "allday",
      "timed",
      "undated",
      "done",
    ]);
  });

  it("sorts by priority then date", () => {
    const a = mk({ title: "low", priority: 1 });
    const b = mk({ title: "high-late", priority: 3, schedule: day("2026-12-01") });
    const c = mk({ title: "high-soon", priority: 3, schedule: day("2026-10-26") });
    expect(sortVMs([a, b, c].map(vm), "priority").map((v) => v.task.title)).toEqual(["high-soon", "high-late", "low"]);
  });
});

describe("grouping", () => {
  const ctx = {
    today: TODAY,
    lists: new Map<string, TaskList>(),
    tags: new Map([
      ["x", { id: "x", name: "School", color: null }],
      ["y", { id: "y", name: "home", color: null }],
    ]),
  };

  it("buckets by date in a fixed order", () => {
    const vms = [day("2026-11-30"), day(TODAY), { kind: "none" } as Schedule, day("2026-10-20"), day("2026-10-26")].map(
      (s) => vm(mk({ schedule: s })),
    );
    expect(groupVMs(vms, "date", ctx).map((g) => g.label)).toEqual(["Overdue", "Today", "Tomorrow", "Later", "No date"]);
  });

  it("gives each of the next seven days its own group", () => {
    const vms = [day(addDaysLocal(TODAY, 3)), day(addDaysLocal(TODAY, 1)), day(addDaysLocal(TODAY, 6)), day(addDaysLocal(TODAY, 7))].map((s) => vm(mk({ schedule: s })));
    const labels = groupVMs(vms, "date", ctx).map((g) => g.label);
    expect(labels).toHaveLength(4);
    expect(labels[0]).toBe("Tomorrow");
    expect(labels[1]).toBe("Wednesday 28 Oct");
    expect(labels[3]).toBe("Later");
  });

  it("puts multi-tag tasks in every tag group", () => {
    const g = groupVMs([vm(mk({ tags: ["x", "y"] })), vm(mk())], "tag", ctx);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([
      ["#home", 1],
      ["#School", 1],
      ["No tag", 1],
    ]);
  });
});

describe("flattenTree", () => {
  it("walks depth-first and respects collapsed parents", () => {
    const p = vm(mk({ title: "p" }));
    const c1 = vm(mk({ title: "c1", parentId: p.task.id }));
    const g = vm(mk({ title: "g", parentId: c1.task.id, status: "done" }));
    const kids: Record<string, TaskVM[]> = { [p.task.id]: [c1], [c1.task.id]: [g] };
    const of = (id: string) => kids[id] ?? [];
    expect(flattenTree([p], of, new Set()).map((r) => [r.vm.task.title, r.depth])).toEqual([
      ["p", 0],
      ["c1", 1],
      ["g", 2],
    ]);
    expect(flattenTree([p], of, new Set([c1.task.id])).map((r) => r.vm.task.title)).toEqual(["p", "c1"]);
    expect(flattenTree([p], of, new Set())[1]).toMatchObject({ shownKids: 1, childCount: 1, doneChildCount: 1 });
  });

  it("counts every subtask even when the view nests only some", () => {
    const p = vm(mk({ title: "p" }));
    const shown = vm(mk({ title: "a", parentId: p.task.id }));
    const hidden = vm(mk({ title: "b", parentId: p.task.id, status: "done" }));
    const row = flattenTree([p], (id) => (id === p.task.id ? [shown] : []), new Set(), (id) => (id === p.task.id ? [shown, hidden] : []))[0];
    expect(row).toMatchObject({ shownKids: 1, childCount: 2, doneChildCount: 1 });
  });
});

describe("topLevelIn", () => {
  it("keeps a subtask on its own only when its parent isn't in the view", () => {
    const p = vm(mk({ title: "p" }));
    const nested = vm(mk({ title: "nested", parentId: p.task.id }));
    const orphan = vm(mk({ title: "orphan", parentId: "elsewhere" }));
    expect(topLevelIn([p, nested, orphan]).map((v) => v.task.title)).toEqual(["p", "orphan"]);
  });
});

describe("matchScore", () => {
  it("ranks exact < prefix < word start < substring and requires every word", () => {
    expect(matchScore("Today", "today")).toBe(0);
    expect(matchScore("Study chem", "stu")).toBe(1);
    expect(matchScore("Study chem", "che")).toBe(2);
    expect(matchScore("Study chem", "hem")).toBe(3);
    expect(matchScore("Study chem", "stu che")).toBe(3);
    expect(matchScore("Study chem", "stu bio")).toBeNull();
    expect(matchScore("a(b", "(b")).toBe(3);
  });
});

describe("planning fields in smart lists (D267)", () => {
  const vmOf = (t: Task) => toVM(t) as TaskVM;
  it("someday tasks leave Today and Upcoming and live in Someday", () => {
    const v = vmOf(mk({ schedule: { kind: "someday" }, deadline: TODAY }));
    expect(inSmartList("today", v, TODAY)).toBe(false);
    expect(inSmartList("upcoming", v, TODAY)).toBe(false);
    expect(inSmartList("someday", v, TODAY)).toBe(true);
  });
  it("Today holds tasks whose deadline is today or past, whatever their planned date", () => {
    expect(inSmartList("today", vmOf(mk({ deadline: TODAY })), TODAY)).toBe(true);
    expect(inSmartList("today", vmOf(mk({ deadline: addDaysLocal(TODAY, -2), schedule: { kind: "day", date: addDaysLocal(TODAY, 3) } })), TODAY)).toBe(true);
    expect(inSmartList("today", vmOf(mk({ deadline: addDaysLocal(TODAY, 1) })), TODAY)).toBe(false);
  });
  it("a waiting task sits in Waiting until its follow-up date, then comes back to Today", () => {
    const t = mk({ schedule: { kind: "day", date: TODAY }, waiting: { kind: "person", who: "Sam", followUp: addDaysLocal(TODAY, 2) } });
    expect(inSmartList("today", vmOf(t), TODAY)).toBe(false);
    expect(inSmartList("waiting", vmOf(t), TODAY)).toBe(true);
    const later = addDaysLocal(TODAY, 2);
    expect(inSmartList("waiting", vmOf(t), later)).toBe(false);
    expect(inSmartList("today", vmOf(mk({ waiting: { kind: "person", who: "Sam", followUp: TODAY } })), TODAY)).toBe(true);
  });
  it("a wait on a task ends when that task is completed", () => {
    const blocker = mk();
    const waiting = mk({ schedule: { kind: "day", date: TODAY }, waiting: { kind: "task", taskId: blocker.id } });
    const vms = (b: Task) => derive({ [b.id]: b, [waiting.id]: waiting }, {}).byId.get(waiting.id)!;
    expect(inSmartList("waiting", vms(blocker), TODAY)).toBe(true);
    expect(inSmartList("today", vms(blocker), TODAY)).toBe(false);
    const done = { ...blocker, status: "done" as const };
    expect(inSmartList("waiting", vms(done), TODAY)).toBe(false);
    expect(inSmartList("today", vms(done), TODAY)).toBe(true);
  });
  it("plannedMinutes adds durations and timed lengths of open tasks", () => {
    const vms = [
      mk({ durationMin: 30 }),
      mk({ schedule: timed(atLocalTime(TODAY, "09:00"), 100), durationMin: 5 }),
      mk({ durationMin: 60, status: "done" }),
      mk(),
    ].map(vmOf);
    expect(plannedMinutes(vms)).toBe(130);
  });
});

describe("matchScore ignores accents and Unicode form (QA-12)", () => {
  it("folds diacritics and NFC/NFD", () => {
    expect(matchScore("Café meeting", "cafe")).not.toBeNull();
    expect(matchScore("Cafe meeting", "café")).not.toBeNull();
    expect(matchScore("Résumé", "resume")).not.toBeNull();
    expect(matchScore("école".normalize("NFC"), "école".normalize("NFD"))).not.toBeNull();
    expect(matchScore("Straße", "strasse")).not.toBeNull();
    expect(matchScore("İstanbul", "istanbul")).not.toBeNull();
  });
});

describe("v1.2.4 smart list fixes", () => {
  it("HAB-11: a future-dated task whose deadline or follow-up has come is in Today only", () => {
    const dl = mk({ schedule: day("2026-10-30"), deadline: TODAY });
    expect(lists("today", "upcoming")(dl)).toEqual(["today"]);
    const fu = mk({ schedule: day("2026-10-30"), waiting: { kind: "person", who: "Sam", followUp: TODAY } });
    expect(lists("today", "upcoming")(fu)).toEqual(["today"]);
  });
  it("HAB-12: a block running past midnight isn't overdue", () => {
    const t = mk({ schedule: timed(atLocalTime("2026-10-24", "23:00"), 120) });
    expect(isOverdue(vm(t), TODAY)).toBe(false);
    expect(isOverdue(vm(mk({ schedule: timed(atLocalTime("2026-10-24", "20:00"), 60) })), TODAY)).toBe(true);
  });
  it("HAB-13: a 01:30 block belongs to the day that started at 3 a.m. before it", () => {
    setDayEndHour(3);
    try {
      const t = mk({ schedule: timed(atLocalTime("2026-10-26", "01:30"), 30) });
      expect(lists("today", "upcoming")(t)).toEqual(["today"]); // TODAY = Sun 25th is still running
    } finally {
      setDayEndHour(0);
    }
  });
  it("HAB-20: lists with negative sortOrder group in numeric order", () => {
    const L = (id: string, sortOrder: number) => ({ id, name: id, sortOrder }) as unknown as TaskList;
    const ls = new Map([["a", L("a", -2)], ["b", L("b", -1)]]);
    const g = groupVMs([vm(mk({ listId: "b" })), vm(mk({ listId: "a" }))], "list", { today: TODAY, lists: ls, tags: new Map() });
    expect(g.map((x) => x.label)).toEqual(["a", "b"]);
  });
});

describe("sortVMs with a saved manual order (D331)", () => {
  it("follows the saved ids, then the rest by their own order", () => {
    const [a, b, c, d] = [mk(), mk(), mk(), mk()].map((t) => toVM(t)!);
    const saved = [c.task.id, a.task.id, "gone"];
    expect(sortVMs([a, b, c, d], "manual", saved).map((v) => v.task.id)).toEqual([c.task.id, a.task.id, b.task.id, d.task.id]);
  });
  it("ignores the saved order for other sorts", () => {
    const [a, b] = [mk({ priority: 1 }), mk({ priority: 3 })].map((t) => toVM(t)!);
    expect(sortVMs([a, b], "priority", [a.task.id, b.task.id]).map((v) => v.task.id)).toEqual([b.task.id, a.task.id]);
  });
});

describe("hiddenAsOld (FEAT-17)", () => {
  const done = (iso: string) => mk({ status: "done", completedAt: iso });
  it("hides finished tasks older than N days only", () => {
    expect(hiddenAsOld(done("2026-10-01T15:00:00Z"), TODAY, 7)).toBe(true);
    expect(hiddenAsOld(done("2026-10-20T15:00:00Z"), TODAY, 7)).toBe(false);
    expect(hiddenAsOld(done("2026-10-01T15:00:00Z"), TODAY, null)).toBe(false);
    expect(hiddenAsOld(mk(), TODAY, 7)).toBe(false);
  });
  it("Today keeps only what was finished today; Upcoming the past week; lists three months", () => {
    const today = done(`${TODAY}T15:00:00Z`);
    const yesterday = done(`${addDaysLocal(TODAY, -1)}T15:00:00Z`);
    expect(hiddenAsOld(today, TODAY, doneWindowDays("today"))).toBe(false);
    expect(hiddenAsOld(yesterday, TODAY, doneWindowDays("today"))).toBe(true);
    expect(hiddenAsOld(done(`${addDaysLocal(TODAY, -7)}T15:00:00Z`), TODAY, doneWindowDays("upcoming"))).toBe(false);
    expect(hiddenAsOld(done(`${addDaysLocal(TODAY, -8)}T15:00:00Z`), TODAY, doneWindowDays("upcoming"))).toBe(true);
    expect(hiddenAsOld(done(`${addDaysLocal(TODAY, -90)}T15:00:00Z`), TODAY, doneWindowDays("list:abc"))).toBe(false);
    expect(hiddenAsOld(done(`${addDaysLocal(TODAY, -91)}T15:00:00Z`), TODAY, doneWindowDays("list:abc"))).toBe(true);
  });
});
