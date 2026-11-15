import { describe, expect, it } from "vitest";
import { durationMinutes, fromLocalDate, wallKey } from "./dates";
import { parseQuickAdd, withDefaults, withoutToken, withToken } from "./quickAdd";

// Sunday 25 Oct 2026, 10:00 local (TZ=America/New_York).
const NOW = new Date(2026, 9, 25, 10, 0);
const startKey = (s: ReturnType<typeof parseQuickAdd>["schedule"]) =>
  s.kind === "timed" ? wallKey(new Date(s.start)) : null;

describe("parseQuickAdd", () => {
  it("parses the brief's example", () => {
    const p = parseQuickAdd("Study chem tomorrow 5pm !high #school", NOW);
    expect(p.title).toBe("Study chem");
    expect(startKey(p.schedule)).toBe("2026-10-26T17:00");
    expect(durationMinutes(p.schedule)).toBe(60);
    expect(p.priority).toBe(3);
    expect(p.tags).toEqual(["school"]);
    expect(p.chips.map((c) => [c.kind, c.text])).toEqual([
      ["date", "tomorrow 5pm"],
      ["priority", "!high"],
      ["tag", "#school"],
    ]);
  });

  it("gives all-day schedules when no time is stated", () => {
    const p = parseQuickAdd("Call mom friday", NOW);
    expect(p.title).toBe("Call mom");
    expect(p.schedule).toEqual({ kind: "day", date: "2026-10-30" });
    expect(fromLocalDate("2026-10-30").getDay()).toBe(5);
  });

  it("uses an explicit end time", () => {
    const p = parseQuickAdd("Standup tomorrow 3pm-4:30pm", NOW);
    expect(p.title).toBe("Standup");
    expect(durationMinutes(p.schedule)).toBe(90);
  });

  it("parses repeat phrases without treating the weekday as a one-off date", () => {
    const p = parseQuickAdd("Gym every mon and wed 7am", NOW);
    expect(p.title).toBe("Gym");
    expect(p.rule).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(startKey(p.schedule)?.slice(11)).toBe("07:00");

    expect(parseQuickAdd("Pay rent monthly !2", NOW)).toMatchObject({ title: "Pay rent", rule: "FREQ=MONTHLY", priority: 2 });
    expect(parseQuickAdd("Water plants every other day", NOW).rule).toBe("FREQ=DAILY;INTERVAL=2");
    expect(parseQuickAdd("Review every weekday", NOW).rule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseQuickAdd("Backup every 3 weeks", NOW).rule).toBe("FREQ=WEEKLY;INTERVAL=3");
  });

  it("anchors a date-less repeat on today", () => {
    expect(parseQuickAdd("Stretch daily", NOW).schedule).toEqual({ kind: "day", date: "2026-10-25" });
  });

  it("extracts several tags and a list", () => {
    const p = parseQuickAdd("#a write report #b-2 ~Work", NOW);
    expect(p).toMatchObject({ title: "write report", tags: ["a", "b-2"], listName: "Work" });
  });

  it("ignores unknown priorities and plain text", () => {
    const p = parseQuickAdd("email bob !wow", NOW);
    expect(p).toMatchObject({ title: "email bob !wow", priority: null, schedule: { kind: "none" } });
  });

  it("drops a dangling preposition left by the date", () => {
    expect(parseQuickAdd("Dentist on Nov 3", NOW)).toMatchObject({
      title: "Dentist",
      schedule: { kind: "day", date: "2026-11-03" },
    });
  });

  it("keeps the raw text when parsing is disabled", () => {
    const p = parseQuickAdd("Study tomorrow #x", NOW, false);
    expect(p).toMatchObject({ title: "Study tomorrow #x", tags: [], schedule: { kind: "none" }, chips: [] });
  });

  it("falls back to the input when only tokens were typed", () => {
    expect(parseQuickAdd("#urgent", NOW).title).toBe("#urgent");
  });
});

describe("keyword tokens (D89, D90)", () => {
  const LISTS = ["School", "Home Chores", "Home", "Family"];
  const spoken = (t: string, lists = LISTS) => parseQuickAdd(t, NOW, true, lists, "spoken");
  it("reads spoken priority, tag and list phrases", () => {
    const p = spoken("Study chem tomorrow, priority high, tag chemistry, list School.");
    expect(p).toMatchObject({ title: "Study chem", priority: 3, tags: ["chemistry"], listName: "School" });
    expect(p.chips.map((c) => c.kind)).toEqual(["date", "priority", "tag", "list"]);
  });
  it("accepts 'high priority' word order", () => {
    expect(spoken("call mom low priority").priority).toBe(1);
  });
  it("prefers the longest existing list name", () => {
    expect(spoken("vacuum list home chores")).toMatchObject({ title: "vacuum", listName: "Home Chores" });
  });
  it("leaves keyword forms alone in typed entries, so 'Grocery list' stays a title", () => {
    expect(parseQuickAdd("Grocery list", NOW, true, ["Grocery"])).toMatchObject({ title: "Grocery list", listName: null });
    expect(parseQuickAdd("call mom list family priority high tag x", NOW, true, LISTS)).toMatchObject({
      title: "call mom list family priority high tag x",
      listName: null,
      priority: null,
      tags: [],
    });
    expect(parseQuickAdd("call mom ~Family !high #x", NOW, true, LISTS)).toMatchObject({ title: "call mom", listName: "Family", priority: 3, tags: ["x"] });
  });
  it("takes the same words as a list when spoken", () => {
    expect(spoken("call mom list family")).toMatchObject({ title: "call mom", listName: "Family" });
  });
  it("fuzzy-matches a spoken list name to an existing list", () => {
    expect(spoken("call mom list familly")).toMatchObject({ title: "call mom", listName: "Family" });
    expect(spoken("do essay list skool, tomorrow")).toMatchObject({ title: "do essay", listName: "School" });
  });
  it("keeps the words in the title when no list is close enough or prose follows", () => {
    expect(spoken("buy milk list Errands")).toMatchObject({ title: "buy milk list Errands", listName: null });
    expect(spoken("make a list of groceries")).toMatchObject({ title: "make a list of groceries", listName: null });
    expect(spoken("finish the list")).toMatchObject({ listName: null });
    expect(spoken("buy milk list school", [])).toMatchObject({ listName: null });
  });
});

describe("withToken", () => {
  it("replaces an existing chip or appends a token", () => {
    const text = "study !low";
    const p = parseQuickAdd(text, NOW);
    expect(withToken(text, p.chips, "priority", "!high")).toBe("study !high");
    expect(withToken(text, p.chips, "list", "~School")).toBe("study !low ~School");
    expect(withToken("", [], "list", "~School")).toBe("~School");
  });
});

describe("withoutToken", () => {
  it("removes the chip's span and tidies the spaces", () => {
    const text = "study !low tomorrow";
    const p = parseQuickAdd(text, NOW);
    expect(withoutToken(text, p.chips, "priority")).toBe("study tomorrow");
    expect(withoutToken("!low", parseQuickAdd("!low", NOW).chips, "priority")).toBe("");
    expect(withoutToken("study", [], "list")).toBe("study");
  });
});

describe("single-valued and duplicate tokens (D219)", () => {
  const spoken = (t: string, lists: string[] = ["School"]) => parseQuickAdd(t, NOW, true, lists, "spoken");
  it("collapses a repeated spoken priority and duplicate tags to one chip each", () => {
    const p = spoken("Make a milkshake when I get home. High priority, high priority. Tag economics. Tag English. Tag economics");
    expect(p.priority).toBe(3);
    expect(p.tags).toEqual(["economics", "English"]);
    expect(p.chips.map((c) => c.kind)).toEqual(["priority", "tag", "tag"]);
    expect(p.title).toBe("Make a milkshake when I get home");
  });
  it("collapses typed !high !high; the first priority wins", () => {
    const p = parseQuickAdd("call mom !high !low #a #A", NOW);
    expect(p).toMatchObject({ title: "call mom", priority: 3, tags: ["a"] });
    expect(p.chips.map((c) => c.kind)).toEqual(["priority", "tag"]);
  });
  it("labels a spoken tag chip by the tag, not the spoken words", () => {
    expect(spoken("buy milk tag economics").chips[0]).toMatchObject({ kind: "tag", value: "economics" });
    expect(parseQuickAdd("buy milk #econ", NOW).chips[0].value).toBe("econ");
  });
  it("reads 'hashtag X', 'tag: X' and 'in list X'", () => {
    expect(spoken("buy milk hashtag economics")).toMatchObject({ title: "buy milk", tags: ["economics"] });
    expect(spoken("buy milk. Tag: economics.")).toMatchObject({ title: "buy milk", tags: ["economics"] });
    expect(spoken("buy milk in list school")).toMatchObject({ title: "buy milk", listName: "School" });
    expect(spoken("buy milk, medium priority").priority).toBe(2);
  });
});

describe("withDefaults: a view's context vs explicit tokens (D220)", () => {
  const ctx = { schedule: { kind: "day", date: "2026-11-02" } as const, priority: 1 as const, tags: ["ctx"] };
  it("uses the defaults when the text has no tokens", () => {
    expect(withDefaults(parseQuickAdd("write essay", NOW), ctx)).toEqual({ schedule: ctx.schedule, priority: 1, tags: ["ctx"], recurrence: null });
  });
  it("lets an explicit date, priority and recurrence win; tags merge", () => {
    const r = withDefaults(parseQuickAdd("write essay tomorrow !high #school", NOW), ctx);
    expect(r.schedule).toEqual({ kind: "day", date: "2026-10-26" });
    expect(r.priority).toBe(3);
    expect(r.tags).toEqual(["ctx", "school"]);
  });
  it("keeps the context date for a repeat with no date of its own", () => {
    const r = withDefaults(parseQuickAdd("water plants every day", NOW), ctx);
    expect(r.schedule).toEqual(ctx.schedule);
    expect(r.recurrence).toEqual({ rule: "FREQ=DAILY", exdates: [] });
  });
  it("a repeat with no date and no context starts today", () => {
    expect(withDefaults(parseQuickAdd("water plants every day", NOW), {}).schedule).toEqual({ kind: "day", date: "2026-10-25" });
  });
});

describe("planning tokens (D267)", () => {
  it("reads the spec's example: a deadline and a duration", () => {
    const p = parseQuickAdd("call mom by fri 15m", NOW);
    expect(p.title).toBe("call mom");
    expect(p.deadline).toBe("2026-10-30");
    expect(p.durationMin).toBe(15);
    expect(p.schedule).toEqual({ kind: "none" });
    expect(p.chips.map((c) => [c.kind, c.text])).toEqual([
      ["deadline", "by fri"],
      ["duration", "15m"],
    ]);
  });

  it("reads numeric deadlines and keeps a planned date apart from the deadline", () => {
    const p = parseQuickAdd("essay tomorrow by 12/3", NOW);
    expect(p.deadline).toBe("2026-12-03");
    expect(p.schedule).toEqual({ kind: "day", date: "2026-10-26" });
    expect(p.title).toBe("essay");
  });

  it("reads 1h30m, ~2h and 90min as durations, and ~2h is not a list", () => {
    expect(parseQuickAdd("run 1h30m", NOW).durationMin).toBe(90);
    const tilde = parseQuickAdd("deep work ~2h", NOW);
    expect(tilde.durationMin).toBe(120);
    expect(tilde.listName).toBeNull();
    expect(parseQuickAdd("read 90min", NOW).durationMin).toBe(90);
    expect(parseQuickAdd("~Home chores", NOW).listName).toBe("Home");
  });

  it("someday sets the Someday planned date and drops a repeat", () => {
    const p = parseQuickAdd("learn piano someday", NOW);
    expect(p.schedule).toEqual({ kind: "someday" });
    expect(p.title).toBe("learn piano");
    expect(parseQuickAdd("water plants daily someday", NOW).rule).toBeNull();
  });

  it("waiting @sam fri sets a person and the follow-up; no date means three days", () => {
    const p = parseQuickAdd("contract waiting @sam fri", NOW);
    expect(p.waiting).toEqual({ kind: "person", who: "sam", followUp: "2026-10-30" });
    expect(p.title).toBe("contract");
    expect(p.schedule).toEqual({ kind: "none" });
    expect(parseQuickAdd("invoice waiting for @Ana", NOW).waiting).toEqual({ kind: "person", who: "Ana", followUp: "2026-10-28" });
  });

  it("leaves words that only look like tokens alone", () => {
    const p = parseQuickAdd("stand by me 5", NOW);
    expect(p.deadline).toBeNull();
    expect(p.durationMin).toBeNull();
    expect(parseQuickAdd("email sam@x.com waiting", NOW).waiting).toBeNull();
  });

  it("withDefaults carries the planning fields to the new task", () => {
    const r = withDefaults(parseQuickAdd("call mom by fri 15m", NOW), {});
    expect(r).toMatchObject({ deadline: "2026-10-30", durationMin: 15 });
    expect(withDefaults(parseQuickAdd("x someday", NOW), { schedule: { kind: "day", date: "2026-10-25" } }).schedule).toEqual({ kind: "someday" });
  });
});

describe("durations and token order (v1.2.1 G2)", () => {
  it("H3: a duration sets the end of a timed task with no until", () => {
    const p = parseQuickAdd("call 5pm 30m", NOW);
    expect(p.durationMin).toBe(30);
    expect(p.schedule.kind).toBe("timed");
    if (p.schedule.kind === "timed") expect(durationMinutes(p.schedule)).toBe(30);
    const q = parseQuickAdd("call 30m 5pm", NOW);
    if (q.schedule.kind === "timed") expect(durationMinutes(q.schedule)).toBe(30);
  });

  it.each([["15 min", 15], ["15 mins", 15], ["1h 30m", 90], ["1 h 30 min", 90], ["90 minutes", 90], ["1h30m", 90], ["2 hours", 120]])(
    "H4: %s is a duration, not a start time",
    (t, min) => {
      const p = parseQuickAdd(`call mom ${t}`, NOW);
      expect(p.durationMin).toBe(min);
      expect(p.schedule).toEqual({ kind: "none" });
      expect(p.title).toBe("call mom");
    },
  );

  it("keeps every token in every order", () => {
    const toks = ["!high", "#tag", "~Home", "30m", "by fri"];
    const perms = (a: string[]): string[][] => (a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));
    for (const order of perms(toks)) {
      const ctx = order.join(" ");
      const p = parseQuickAdd(`call mom ${ctx}`, NOW);
      expect([ctx, p.priority, p.tags, p.listName, p.durationMin, p.deadline, p.title]).toEqual([ctx, 3, ["tag"], "Home", 30, "2026-10-30", "call mom"]);
    }
  });

  it("keeps the tag next to a spoken priority", () => {
    for (const t of ["high priority tag chem", "tag chem high priority", "priority high #chem", "#chem priority high"]) {
      const p = parseQuickAdd(`read ${t}`, NOW, true, [], "spoken");
      expect([t, p.priority, p.tags]).toEqual([t, 3, ["chem"]]);
    }
  });
});
