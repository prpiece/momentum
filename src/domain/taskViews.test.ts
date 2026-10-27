import { describe, expect, it } from "vitest";
import { atLocalTime, timed } from "./dates";
import { flattenTree, groupVMs, inSmartList, isOverdue, matchScore, sortVMs, toVM, type TaskVM } from "./taskViews";
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

  it("puts finished tasks only in the Logbook", () => {
    const all: SmartListId[] = ["inbox", "today", "upcoming", "logbook"];
    expect(lists(...all)(mk({ status: "done", priority: 3, schedule: day(TODAY) }))).toEqual(["logbook"]);
    expect(lists(...all)(mk({ status: "wont_do" }))).toEqual(["logbook"]);
    expect(isOverdue(vm(mk({ status: "done", schedule: day("2026-10-01") })), TODAY)).toBe(false);
  });

  it("dates timed tasks by their local start day", () => {
    expect(lists("today")(mk({ schedule: timed(atLocalTime(TODAY, "23:30"), 60) }))).toEqual(["today"]);
  });

  it("uses the current occurrence of a recurring task", () => {
    const t = mk({ schedule: day("2026-10-20"), recurrence: { rule: "FREQ=DAILY", exdates: ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"] } });
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
    expect(flattenTree([p], of, new Set())[1]).toMatchObject({ childCount: 1, doneChildCount: 1 });
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
