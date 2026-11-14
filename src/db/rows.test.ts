import { describe, expect, it } from "vitest";
import { eventToRow, parseEvent, parseTask, taskToRow } from "./rows";
import type { CalendarEvent, Task } from "../domain/types";

const base: Task = {
  id: "t1",
  title: "Write report",
  description: "**bold**",
  listId: "inbox",
  parentId: null,
  sectionId: null,
  status: "open",
  priority: 2,
  schedule: { kind: "timed", start: "2026-10-25T14:00:00.000Z", end: "2026-10-25T15:00:00.000Z" },
  recurrence: { rule: "FREQ=WEEKLY;BYDAY=MO", exdates: ["2026-10-26T10:00"] },
  deadline: null,
  durationMin: null,
  waiting: null,
  recurrenceParentId: null,
  tags: ["a"],
  checklist: [{ id: "c", title: "Outline", done: true }],
  reminders: [{ kind: "before", minutes: 15 }],
  sortOrder: 1.5,
  pinned: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  completedAt: null,
  deletedAt: null,
};

describe("task rows", () => {
  it("round-trips through the row shape (SQLite stores booleans as 0/1)", () => {
    expect(parseTask(taskToRow(base))).toEqual(base);
    const day: Task = { ...base, schedule: { kind: "day", date: "2026-10-25" }, recurrence: null };
    expect(parseTask(taskToRow(day))).toEqual(day);
  });

  it("round-trips the planning fields (D267)", () => {
    const t: Task = { ...base, schedule: { kind: "someday" }, recurrence: null, deadline: "2026-10-30", durationMin: 45, waiting: { kind: "person", who: "Sam", followUp: "2026-11-02" } };
    expect(parseTask(taskToRow(t))).toEqual(t);
    const w: Task = { ...base, waiting: { kind: "task", taskId: "t2" } };
    expect(parseTask(taskToRow(w))).toEqual(w);
  });

  it("drops bad planning fields: a wait on itself, odd durations, a someday series", () => {
    const t = parseTask({ ...taskToRow(base), start_at: null, end_at: null, someday: 1, duration_min: 0, deadline: "fri", waiting: JSON.stringify({ kind: "task", taskId: "t1" }) });
    expect(t).toMatchObject({ schedule: { kind: "someday" }, recurrence: null, durationMin: null, deadline: null, waiting: null });
    expect(parseTask({ ...taskToRow(base), duration_min: 2000 })?.durationMin).toBeNull();
  });

  it("repairs bad fields instead of crashing", () => {
    const t = parseTask({
      ...taskToRow(base),
      status: "weird",
      priority: 9,
      tags: "{not json",
      checklist: JSON.stringify([{ id: 1 }, { id: "ok", title: "x" }]),
      reminders: JSON.stringify([{ kind: "before", minutes: -5 }, { kind: "dayOf", daysBefore: 1, time: "09:00" }]),
      rrule: "NONSENSE",
      due_date: "2026-02-30",
      start_at: null,
    });
    expect(t).toMatchObject({
      status: "open",
      priority: 0,
      tags: [],
      checklist: [{ id: "ok", title: "x", done: false }],
      reminders: [{ kind: "dayOf", daysBefore: 1, time: "09:00" }],
      recurrence: null,
      schedule: { kind: "none" },
    });
  });

  it("drops rows without identity", () => {
    expect(parseTask({ title: "x" })).toBeNull();
  });
});

describe("event rows", () => {
  const e: CalendarEvent = {
    id: "e1",
    title: "Conference",
    notes: "",
    schedule: { kind: "day", date: "2026-11-02" },
    spanDays: 3,
    color: "#2f6fed",
    subscriptionId: null,    countdown: "until",
    pinned: true,
    recurrence: null,
    recurrenceParentId: null,
    source: "ics",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    deletedAt: null,
  };
  it("round-trips and rejects events without a time", () => {
    expect(parseEvent(eventToRow(e))).toEqual(e);
    expect(parseEvent({ ...eventToRow(e), start_date: null })).toBeNull();
    expect(parseEvent({ ...eventToRow(e), span_days: -4 })?.spanDays).toBe(1);
  });
});
