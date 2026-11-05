import { describe, expect, it } from "vitest";
import { durationMinutes, fromLocalDate, wallKey } from "./dates";
import { parseQuickAdd, withoutToken, withToken } from "./quickAdd";

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
