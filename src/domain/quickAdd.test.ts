import { describe, expect, it } from "vitest";
import { durationMinutes, fromLocalDate, setDateOrder, wallKey } from "./dates";
import { defaultReminders, parseQuickAdd, tokenPatch, withDefaults, withoutToken, withToken } from "./quickAdd";

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

  it("reads 'every other/N <weekday list>' with an interval", () => {
    const sat = new Date(2026, 2, 7, 10, 0);
    expect(parseQuickAdd("Gym every other monday", sat)).toMatchObject({ title: "Gym", rule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO" });
    expect(parseQuickAdd("Sync every other mon and thu", sat)).toMatchObject({ title: "Sync", rule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH" });
    expect(parseQuickAdd("Sync every 3 fridays", sat)).toMatchObject({ title: "Sync", rule: "FREQ=WEEKLY;INTERVAL=3;BYDAY=FR" });
    expect(parseQuickAdd("Gym every monday", sat).rule).toBe("FREQ=WEEKLY;BYDAY=MO");
  });

  it("joins a list of monthly days", () => {
    const sat = new Date(2026, 2, 7, 10, 0);
    expect(parseQuickAdd("exercise every 1st and 15th", sat)).toMatchObject({ title: "exercise", rule: "FREQ=MONTHLY;BYMONTHDAY=1,15" });
    expect(parseQuickAdd("exercise every 15th", sat)).toMatchObject({ title: "exercise", rule: "FREQ=MONTHLY;BYMONTHDAY=15" });
    expect(parseQuickAdd("pay every 1st, 10th & 20th", sat).rule).toBe("FREQ=MONTHLY;BYMONTHDAY=1,10,20");
  });

  it("an hours-based duration after 'in N hours' is still a duration", () => {
    const now = new Date(2026, 2, 7, 10, 0);
    const at = (text: string) => {
      const p = parseQuickAdd(text, now);
      return [startKey(p.schedule), p.durationMin];
    };
    expect(at("call in 2 hours 1h")).toEqual(["2026-03-07T12:00", 60]);
    expect(at("call in 2 hours 1h 30m")).toEqual(["2026-03-07T12:00", 90]);
    expect(at("meeting in 2 hours 1h30m")).toEqual(["2026-03-07T12:00", 90]);
    expect(at("call in 3 hours 2h")).toEqual(["2026-03-07T13:00", 120]);
  });

  it("'in 2 hours 15 min' is one offset, not a time plus a duration", () => {
    const p = parseQuickAdd("meeting in 2 hours 15 min", new Date(2026, 2, 7, 23, 30));
    expect(p.title).toBe("meeting");
    expect(startKey(p.schedule)).toBe("2026-03-08T01:45");
    expect(p.durationMin).toBeNull();
    expect(parseQuickAdd("call in 2 hours", new Date(2026, 2, 7, 10, 0)).schedule.kind).toBe("timed");
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
    expect(r.recurrence).toEqual({ rule: "FREQ=DAILY", exdates: [], tz: null });
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

// v1.2.4 findings (QA-01..QA-15): Fri 13 Nov 2026.
describe("v1.2.4 quick-add findings", () => {
  const FRI = (h: number, m = 0) => new Date(2026, 10, 13, h, m);
  const day = (t: string, now: Date) => parseQuickAdd(t, now).schedule;

  it("QA-01: a date-only word naming today stays today at any hour", () => {
    expect(day("fri gym", FRI(15))).toEqual({ kind: "day", date: "2026-11-13" });
    expect(day("fri gym", FRI(23, 59))).toEqual({ kind: "day", date: "2026-11-13" });
    expect(day("nov 13 gym", FRI(15))).toEqual({ kind: "day", date: "2026-11-13" });
    expect(day("this fri gym", FRI(15))).toEqual({ kind: "day", date: "2026-11-13" });
    expect(parseQuickAdd("gym by fri", FRI(15)).deadline).toBe("2026-11-13");
    expect(day("dec 31 party", new Date(2026, 11, 31, 23, 59))).toEqual({ kind: "day", date: "2026-12-31" });
    expect(day("fri gym", FRI(9))).toEqual({ kind: "day", date: "2026-11-13" });
    // a day already past still rolls forward, and timed phrases keep the real clock
    expect(day("thu gym", FRI(15))).toEqual({ kind: "day", date: "2026-11-19" });
    expect(startKey(day("meet 1pm", FRI(15)))).toBe("2026-11-14T13:00");
  });

  it("QA-02: a bare hour 1-7 is the afternoon", () => {
    expect(startKey(day("meet at 5", FRI(10)))).toBe("2026-11-13T17:00");
    expect(startKey(day("dinner at 7", FRI(10)))).toBe("2026-11-13T19:00");
    expect(startKey(day("tomorrow at 5", FRI(10)))).toBe("2026-11-14T17:00");
    expect(startKey(day("meet at 9", FRI(8)))).toBe("2026-11-13T09:00");
    expect(startKey(day("meet at 5am", FRI(3)))).toBe("2026-11-13T05:00");
    expect(startKey(day("lunch at 12", FRI(8)))).toBe("2026-11-13T12:00");
    expect(startKey(day("in 3 hours call", FRI(2)))).toBe("2026-11-13T05:00");
  });

  it("QA-03: '9 to 5' is 9am-5pm", () => {
    const s = day("tomorrow 9 to 5", FRI(10));
    expect(startKey(s)).toBe("2026-11-14T09:00");
    expect(durationMinutes(s)).toBe(480);
  });

  it("QA-04: 'in 2 hours' is a time, not a duration", () => {
    const p = parseQuickAdd("in 2 hours call", FRI(10));
    expect(p.title).toBe("call");
    expect(p.durationMin).toBeNull();
    expect(startKey(p.schedule)).toBe("2026-11-13T12:00");
    expect(parseQuickAdd("in 30 min call", FRI(10)).durationMin).toBeNull();
    expect(parseQuickAdd("call 30 min", FRI(10)).durationMin).toBe(30);
  });

  it("QA-05: decimal and bracketed durations", () => {
    expect(parseQuickAdd("write report 1.5h", FRI(10))).toMatchObject({ title: "write report", durationMin: 90, schedule: { kind: "none" } });
    expect(parseQuickAdd("write report 1.5 hours", FRI(10))).toMatchObject({ title: "write report", durationMin: 90, schedule: { kind: "none" } });
    expect(parseQuickAdd("meeting (30m)", FRI(10))).toMatchObject({ title: "meeting", durationMin: 30, schedule: { kind: "none" } });
  });

  it("QA-06: ordinal repeats", () => {
    expect(parseQuickAdd("rent every month on the 15th", FRI(10))).toMatchObject({ title: "rent", rule: "FREQ=MONTHLY;BYMONTHDAY=15" });
    expect(parseQuickAdd("rent monthly on the 1st", FRI(10))).toMatchObject({ title: "rent", rule: "FREQ=MONTHLY;BYMONTHDAY=1" });
    expect(parseQuickAdd("rent every 15th", FRI(10))).toMatchObject({ title: "rent", rule: "FREQ=MONTHLY;BYMONTHDAY=15" });
    expect(parseQuickAdd("club every 2nd tuesday", FRI(10))).toMatchObject({ title: "club", rule: "FREQ=MONTHLY;BYDAY=2TU" });
    expect(parseQuickAdd("club every last friday", FRI(10))).toMatchObject({ title: "club", rule: "FREQ=MONTHLY;BYDAY=-1FR" });
    expect(parseQuickAdd("club first monday of the month", FRI(10))).toMatchObject({ title: "club", rule: "FREQ=MONTHLY;BYDAY=1MO" });
  });

  it("QA-07: weekend, biweekly, until, count", () => {
    expect(parseQuickAdd("hike every weekend", FRI(10))).toMatchObject({ title: "hike", rule: "FREQ=WEEKLY;BYDAY=SA,SU" });
    expect(parseQuickAdd("trash bi-weekly", FRI(10))).toMatchObject({ title: "trash", rule: "FREQ=WEEKLY;INTERVAL=2" });
    expect(parseQuickAdd("trash fortnightly", FRI(10))).toMatchObject({ title: "trash", rule: "FREQ=WEEKLY;INTERVAL=2" });
    const u = parseQuickAdd("water every 3 days until dec 1", FRI(10));
    expect(u).toMatchObject({ title: "water", schedule: { kind: "day", date: "2026-11-13" } });
    expect(u.rule).toMatch(/^FREQ=DAILY;INTERVAL=3;UNTIL=20261201/);
    expect(parseQuickAdd("pills daily x5", FRI(10))).toMatchObject({ title: "pills", rule: "FREQ=DAILY;COUNT=5" });
  });

  it("QA-07: 'for N weeks' counts the occurrences; weeknight is Mon-Fri", () => {
    expect(parseQuickAdd("yoga weekly for 5 weeks", FRI(10))).toMatchObject({ title: "yoga", rule: "FREQ=WEEKLY;COUNT=5" });
    expect(parseQuickAdd("run every mon and wed for 4 weeks", FRI(10))).toMatchObject({ title: "run", rule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8" });
    expect(parseQuickAdd("stretch daily for 2 weeks", FRI(10)).rule).toMatch(/^FREQ=DAILY;UNTIL=20261127/);
    expect(parseQuickAdd("read every weeknight", FRI(10))).toMatchObject({ title: "read", rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" });
  });

  it("QA-18: eod, eow, eom and 'remind me to'", () => {
    expect(parseQuickAdd("send report eod", FRI(15))).toMatchObject({ title: "send report", schedule: { kind: "day", date: "2026-11-13" } });
    expect(parseQuickAdd("send report eow", new Date(2026, 10, 11, 9))).toMatchObject({ title: "send report", schedule: { kind: "day", date: "2026-11-13" } });
    expect(parseQuickAdd("send report end of week", new Date(2026, 10, 14, 9)).schedule).toEqual({ kind: "day", date: "2026-11-20" });
    expect(parseQuickAdd("invoice eom", FRI(10))).toMatchObject({ title: "invoice", schedule: { kind: "day", date: "2026-11-30" } });
    expect(parseQuickAdd("remind me to call mom tomorrow", FRI(10))).toMatchObject({ title: "call mom", schedule: { kind: "day", date: "2026-11-14" } });
  });

  it("QA-08: ambiguous lone words are not dates", () => {
    for (const t of ["SAT prep", "study for the sat", "sun cream", "mon ami", "march madness", "pay $5 now"])
      expect(parseQuickAdd(t, FRI(10))).toMatchObject({ title: t, schedule: { kind: "none" } });
    expect(day("gym on sat", FRI(10))).toEqual({ kind: "day", date: "2026-11-14" });
    expect(day("gym next sun", FRI(10)).kind).toBe("day");
    expect(day("party march 5", FRI(10))).toEqual({ kind: "day", date: "2027-03-05" });
  });

  it("QA-09: no orphaned possessives or empty brackets", () => {
    expect(parseQuickAdd("tomorrow's plan", FRI(10))).toMatchObject({ title: "tomorrow's plan", schedule: { kind: "none" } });
    expect(parseQuickAdd("Tuesday's meeting", FRI(10)).title).toBe("Tuesday's meeting");
    expect(parseQuickAdd("Task A (tomorrow)", FRI(10)).title).toBe("Task A");
    expect(parseQuickAdd('"tomorrow" movie', FRI(10)).title).toBe("movie");
  });

  it("QA-10/11: tags keep combining marks and inner punctuation", () => {
    expect(parseQuickAdd("#हिन्दी x", FRI(10))).toMatchObject({ title: "x", tags: ["हिन्दी"] });
    expect(parseQuickAdd("#café x", FRI(10))).toMatchObject({ title: "x", tags: ["café"] });
    expect(parseQuickAdd("#v1.2 x", FRI(10))).toMatchObject({ title: "x", tags: ["v1.2"] });
    expect(parseQuickAdd("#work. x", FRI(10)).tags).toEqual(["work"]);
    expect(parseQuickAdd("#c++ x", FRI(10)).tags).toEqual([]);
    expect(parseQuickAdd("#don't x", FRI(10)).tags).toEqual([]);
    expect(parseQuickAdd("~Home/Away x", FRI(10))).toMatchObject({ title: "x", listName: "Home/Away" });
    expect(parseQuickAdd("~List's x", FRI(10)).listName).toBeNull();
  });

  it("QA-15: a typed ~List can name a list with spaces", () => {
    expect(parseQuickAdd("buy ~Home Chores now", FRI(10), true, ["Home Chores"])).toMatchObject({ title: "buy now", listName: "Home Chores" });
    expect(parseQuickAdd("buy ~Home now", FRI(10), true, ["Home Chores"])).toMatchObject({ listName: "Home" });
  });

  it("QA-18: a trailing 'due' is dropped with the date", () => {
    expect(parseQuickAdd("report due friday", FRI(10))).toMatchObject({ title: "report", schedule: { kind: "day", date: "2026-11-13" } });
  });
});

describe("FEAT-07 tokenPatch / FEAT-19 defaultReminders", () => {
  const resolve = { tagIds: (n: string[]) => n.map((x) => `id-${x}`), listId: (n: string) => (n === "Work" ? "w" : undefined) };
  it("patches only what the tokens set, stripping them from the title", () => {
    const p = parseQuickAdd("Call Sam tomorrow !high #phone ~Work", NOW, true, ["Work"]);
    expect(tokenPatch(p, { tags: ["old"], parentId: null }, resolve)).toEqual({
      title: "Call Sam", schedule: { kind: "day", date: "2026-10-26" }, priority: 3, tags: ["old", "id-phone"], listId: "w",
    });
    expect(tokenPatch(parseQuickAdd("plain title", NOW), { tags: [], parentId: null }, resolve)).toEqual({ title: "plain title" });
    expect(tokenPatch(p, { tags: [], parentId: "x" }, resolve)).not.toHaveProperty("listId");
  });
  it("default reminder only for timed tasks", () => {
    expect(defaultReminders({ kind: "timed", start: "a", end: "b" }, 10)).toEqual([{ kind: "before", minutes: 10 }]);
    expect(defaultReminders({ kind: "day", date: "2026-10-26" }, 10)).toEqual([]);
    expect(defaultReminders({ kind: "timed", start: "a", end: "b" }, null)).toEqual([]);
  });
});

describe("FEAT-12 numeric dates follow the date order", () => {
  const date = (text: string) => {
    const s = parseQuickAdd(text, NOW).schedule;
    return s.kind === "day" ? s.date : null;
  };
  it("reads 3/4 as March 4 by default and 3 April with day first", () => {
    try {
      setDateOrder("mdy");
      expect(date("dentist 3/4")).toBe("2027-03-04");
      setDateOrder("dmy");
      expect(date("dentist 3/4")).toBe("2027-04-03");
      expect(date("dentist tomorrow")).toBe("2026-10-26");
      expect(parseQuickAdd("dentist 3/4", NOW).title).toBe("dentist");
    } finally {
      setDateOrder("mdy");
    }
  });
});
