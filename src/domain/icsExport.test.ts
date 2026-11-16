import { describe, expect, it } from "vitest";
import { foldIcsLine, parseIcs, toIcs } from "./ics";
import { tasksToJson } from "./export";
import type { CalendarEvent, Task, TaskList } from "./types";

const t = (o: Partial<Task>) => ({ id: "t1", title: "T", description: "", listId: "l", status: "open", priority: 0, schedule: { kind: "none" }, deadline: null, recurrence: null, tags: [], completedAt: null, deletedAt: null, ...o }) as Task;
const NOW = new Date("2026-11-16T12:00:00Z");

describe("toIcs", () => {
  it("writes all-day as DATE, timed as UTC, escapes text and skips undated/done/trashed", () => {
    const ics = toIcs(
      [
        t({ id: "a", title: "Buy milk, eggs; bread", description: "line1\nline2", schedule: { kind: "day", date: "2026-12-31" } }),
        t({ id: "b", schedule: { kind: "timed", start: "2026-11-17T14:00:00.000Z", end: "2026-11-17T15:00:00.000Z" }, recurrence: { rule: "FREQ=WEEKLY", exdates: [] } }),
        t({ id: "c" }),
        t({ id: "d", status: "done", schedule: { kind: "day", date: "2026-01-01" } }),
        t({ id: "e", deletedAt: "x", schedule: { kind: "day", date: "2026-01-01" } }),
      ],
      [],
      NOW,
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
    expect(ics).toContain("SUMMARY:Buy milk\\, eggs\\; bread");
    expect(ics).toContain("DESCRIPTION:line1\\nline2");
    expect(ics).toContain("DTSTART:20261117T140000Z");
    expect(ics).toContain("RRULE:FREQ=WEEKLY");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    const back = parseIcs(ics, "#fff");
    expect(back.events.map((e) => e.title).sort()).toEqual(["Buy milk, eggs; bread", "T"]);
  });
  it("folds long lines at 75 octets without splitting characters", () => {
    const line = "SUMMARY:" + "é".repeat(80);
    const folded = foldIcsLine(line).split("\r\n");
    expect(folded.length).toBeGreaterThan(1);
    for (const p of folded) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(folded.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
  });
  it("exports only own events", () => {
    const ev = (o: Partial<CalendarEvent>) => ({ id: "e", title: "E", notes: "", schedule: { kind: "day", date: "2026-02-01" }, spanDays: 2, recurrence: null, source: "local", deletedAt: null, ...o }) as CalendarEvent;
    const ics = toIcs([], [ev({}), ev({ id: "x", source: "ics" })], NOW);
    expect(ics).toContain("DTEND;VALUE=DATE:20260203");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
});

describe("tasksToJson", () => {
  it("includes live tasks with tag names", () => {
    const j = JSON.parse(tasksToJson([t({ tags: ["g1"] }), t({ id: "z", deletedAt: "x" })], [{ id: "l", name: "Work" } as TaskList], () => "home"));
    expect(j.tasks).toHaveLength(1);
    expect(j.tasks[0].tags).toEqual(["home"]);
    expect(j.lists[0].name).toBe("Work");
  });
});
