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
    deadline: null,
    durationMin: null,
    waiting: null,
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

describe("v1.2.4 filter findings", () => {
  const FRI = new Date(2026, 10, 13, 15, 0);
  const some = (p: Partial<Task>) => mk(p);

  it("QA-01: a weekday naming today still filters to today in the afternoon", () => {
    expect(parseFilter("fri", FRI).date).toEqual({ kind: "on", date: "2026-11-13" });
  });

  it("QA-08/14: ambiguous day words stay searchable text", () => {
    expect(parseFilter("sun cream", FRI)).toMatchObject({ text: "sun cream", date: null });
    expect(parseFilter("SAT prep", FRI)).toMatchObject({ text: "SAT prep", date: null });
  });

  it("QA-14: planning chips filter instead of doing nothing", () => {
    const [a, b, c, d] = [
      some({ schedule: { kind: "someday" } }),
      some({ deadline: "2026-10-27" }),
      some({ durationMin: 30 }),
      some({ waiting: { kind: "person", who: "sam", followUp: "2026-10-30" } }),
    ];
    expect(hits("someday", a, b, c, d)).toEqual([true, false, false, false]);
    expect(hits("by 10/27", a, b, c, d)).toEqual([false, true, false, false]);
    expect(hits("30m", a, b, c, d)).toEqual([false, false, true, false]);
    expect(hits("waiting @sam", a, b, c, d)).toEqual([false, false, false, true]);
    expect(isEmptyFilter(parseFilter("someday", NOW))).toBe(false);
    expect(parseFilter("buy by 10/27", NOW)).toMatchObject({ text: "buy", deadline: "2026-10-27", date: null });
  });

  it("QA-14: a keyword is not overridden by a stray date word", () => {
    expect(parseFilter("overdue today", NOW).date).toEqual({ kind: "overdue" });
  });

  it("QA-13: a leading minus excludes a tag, list or priority", () => {
    const w = some({ tags: ["w"], priority: 3 });
    const s = some({ tags: ["s"], listId: "home" });
    expect(hits("-#work", w, s)).toEqual([false, true]);
    expect(hits("-~HomeStuff", w, s)).toEqual([true, false]);
    expect(hits("-!high", w, s)).toEqual([false, true]);
    expect(parseFilter("-#work", NOW).tags).toEqual([]);
    expect(parseFilter("-#work", NOW).chips.map((c) => c.text)).toEqual(["-#work"]);
  });

  it("QA-13: 'or' between tags matches either", () => {
    const w = some({ tags: ["w"] }), sc = some({ tags: ["s"] }), none = some({});
    expect(hits("#work or #school", w, sc, none)).toEqual([true, true, false]);
    expect(hits("#work #school", w, sc, none)).toEqual([false, false, false]);
    const f = parseFilter("#work or #school", NOW);
    expect(f).toMatchObject({ text: "", tags: [], anyTags: ["work", "school"] });
    expect(f.chips.map((c) => c.text)).toEqual(["#work", "#school"]);
  });

  it("QA-14: this week / next week are ranges that follow the week start", () => {
    const sun = some({ schedule: { kind: "day", date: "2026-10-25" } });
    const mon = some({ schedule: { kind: "day", date: "2026-10-26" } });
    const f = (q: string, ws?: 0 | 1 | 6) => parseFilter(q, NOW, [], ws);
    expect(f("this week").date).toEqual({ kind: "range", from: "2026-10-19", to: "2026-10-25" });
    expect(f("next week").date).toEqual({ kind: "range", from: "2026-10-26", to: "2026-11-01" });
    expect(f("this week", 0).date).toEqual({ kind: "range", from: "2026-10-25", to: "2026-10-31" });
    expect(f("this week #work").text).toBe("");
    const m = (q: string) => [sun, mon].map((v) => matchesFilter(v, f(q), ctx));
    expect(m("this week")).toEqual([true, false]);
    expect(m("next week")).toEqual([false, true]);
  });

  it("QA-12: list names match without accents", () => {
    expect(hits("~HomeStuff", some({ listId: "home" }))).toEqual([true]);
    expect(hits("~hömestuff", some({ listId: "home" }))).toEqual([true]);
  });

  it("QA-15: a list name with a space when the names are known", () => {
    expect(parseFilter("~Home Stuff", NOW, ["Home Stuff"])).toMatchObject({ listName: "Home Stuff", text: "" });
  });
});

it("AGENT-05: prototype names are words, not keywords", () => {
  expect(() => parseFilter("__proto__", new Date(2026, 10, 16))).not.toThrow();
  expect(parseFilter("constructor", new Date(2026, 10, 16)).text).toContain("constructor");
});
