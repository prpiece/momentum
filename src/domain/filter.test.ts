import { describe, expect, it } from "vitest";
import { isEmptyFilter, matchesFilter, parseFilter } from "./filter";
import { toVM, type TaskVM } from "./taskViews";
import type { Tag, Task, TaskList } from "./types";

// Sunday 25 Oct 2026, 10:00 local (TZ=America/New_York).
const NOW = new Date(2026, 9, 25, 10, 0);
const TODAY = "2026-10-25";

const list = (id: string, name: string): TaskList => ({
  id,
  name,
  color: null,
  icon: null,
  folderId: null,
  pinned: false,
  archived: false,
  tint: false,
  layout: "list",
  sortOrder: 0,
});
const tag = (id: string, name: string): Tag => ({ id, name, color: null });
const ctx = {
  today: TODAY,
  lists: { inbox: list("inbox", "Inbox"), home: list("home", "Home Stuff") },
  tags: { w: tag("w", "Work"), s: tag("s", "school") },
};

let n = 0;
function mk(p: Partial<Task> = {}): TaskVM {
  n++;
  const t: Task = {
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
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
    ...p,
  };
  return toVM(t) as TaskVM;
}
const hits = (query: string, ...vms: TaskVM[]) => {
  const f = parseFilter(query, NOW);
  return vms.map((v) => matchesFilter(v, f, ctx));
};

describe("parseFilter", () => {
  it("reads quick-add tokens and leaves no stray text", () => {
    const f = parseFilter("#work !high", NOW);
    expect(f).toMatchObject({ text: "", tags: ["work"], priority: 3, listName: null, date: null, status: null });
    expect(f.chips.map((c) => c.text)).toEqual(["#work", "!high"]);
  });

  it("turns a date phrase into a local day", () => {
    expect(parseFilter("~home tomorrow", NOW)).toMatchObject({ listName: "home", date: { kind: "on", date: "2026-10-26" } });
  });

  it("knows the filter-only keywords", () => {
    expect(parseFilter("overdue #x", NOW)).toMatchObject({ date: { kind: "overdue" }, tags: ["x"] });
    expect(parseFilter("nodate", NOW).date).toEqual({ kind: "none" });
    expect(parseFilter("DONE", NOW).status).toBe("done");
    expect(parseFilter("wontdo", NOW).status).toBe("wont_do");
  });

  it("keeps chip offsets pointing into the original query", () => {
    const q = "done #work";
    expect(parseFilter(q, NOW).chips.map((c) => q.slice(c.start, c.end))).toEqual(["done", "#work"]);
  });

  it("ignores repeat phrases", () => {
    expect(parseFilter("daily", NOW)).toMatchObject({ date: null, text: "" });
  });

  it("is empty for blank input", () => {
    expect(isEmptyFilter(parseFilter("   ", NOW))).toBe(true);
    expect(isEmptyFilter(parseFilter("milk", NOW))).toBe(false);
  });
});

describe("matchesFilter", () => {
  it("matches tags by name, case-insensitively, all required", () => {
    const both = mk({ tags: ["w", "s"], priority: 3 });
    const one = mk({ tags: ["w"] });
    expect(hits("#WORK", both, one)).toEqual([true, true]);
    expect(hits("#work #school", both, one)).toEqual([true, false]);
    expect(hits("#work !high", both, one)).toEqual([true, false]);
  });

  it("matches nothing for an unknown tag", () => {
    expect(hits("#nope", mk({ tags: ["w"] }), mk())).toEqual([false, false]);
  });

  it("matches lists the way quick add resolves them", () => {
    expect(hits("~homestuff", mk({ listId: "home" }), mk())).toEqual([true, false]);
  });

  it("filters by day, overdue and no date", () => {
    const tomorrow = mk({ schedule: { kind: "day", date: "2026-10-26" } });
    const late = mk({ schedule: { kind: "day", date: "2026-10-20" } });
    const lateDone = mk({ schedule: { kind: "day", date: "2026-10-20" }, status: "done" });
    const none = mk();
    expect(hits("tomorrow", tomorrow, late, none)).toEqual([true, false, false]);
    expect(hits("overdue", tomorrow, late, lateDone, none)).toEqual([false, true, false, false]);
    expect(hits("nodate", tomorrow, none)).toEqual([false, true]);
  });

  it("filters by status only when asked", () => {
    const done = mk({ status: "done" });
    const open = mk();
    expect(hits("", done, open)).toEqual([true, true]);
    expect(hits("done", done, open)).toEqual([true, false]);
  });

  it("matches leftover words against the title", () => {
    expect(hits("buy milk", mk({ title: "Buy oat milk" }), mk({ title: "Buy bread" }))).toEqual([true, false]);
  });
});
