import { describe, expect, it } from "vitest";
import { durationMinutes, fromLocalDate, wallKey } from "./dates";
import { parseQuickAdd } from "./quickAdd";

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
