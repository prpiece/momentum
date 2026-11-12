import { describe, expect, it } from "vitest";
import { atLocalTime, timed, wallKey } from "./dates";
import type { Habit } from "./habits";
import type { CalItem } from "./calendar";
import { DEFAULT_SETTINGS } from "./settings";
import { dedupeFires, digestBetween, reminderAt, remindersBetween, startsBetween, streakFires, upcomingFires } from "./reminders";
import { toVM, type TaskVM } from "./taskViews";
import type { Reminder, Schedule, Task } from "./types";

// TZ=America/New_York; 2026-10-25 is a Sunday.

describe("reminders", () => {
  const vm = (schedule: Schedule, reminders: Reminder[], p: Partial<Task> = {}) =>
    toVM({ id: "t", title: "Dentist", description: "", listId: "inbox", parentId: null, sectionId: null, status: "open", priority: 0, schedule, recurrence: null, recurrenceParentId: null, tags: [], checklist: [], reminders, sortOrder: 0, pinned: false, createdAt: "", updatedAt: "", completedAt: null, deletedAt: null, ...p }) as TaskVM;

  it("computes fire times for timed and day schedules, across DST", () => {
    expect(wallKey(reminderAt(timed(atLocalTime("2026-10-26", "09:00"), 30), { kind: "before", minutes: 15 })!)).toBe("2026-10-26T08:45");
    expect(reminderAt({ kind: "day", date: "2026-10-26" }, { kind: "before", minutes: 15 })).toBeNull();
    expect(wallKey(reminderAt({ kind: "day", date: "2026-11-02" }, { kind: "dayOf", daysBefore: 1, time: "18:00" })!)).toBe("2026-11-01T18:00");
    // "1 day before" is wall-clock: 09:00 on Nov 1 (after fall-back) reminds at 09:00 Oct 31, not 10:00.
    expect(wallKey(reminderAt(timed(atLocalTime("2026-11-01", "09:00"), 30), { kind: "before", minutes: 1440 })!)).toBe("2026-10-31T09:00");
    expect(wallKey(reminderAt(timed(atLocalTime("2026-03-08", "09:00"), 30), { kind: "before", minutes: 1440 })!)).toBe("2026-03-07T09:00");
  });

  it("returns only reminders inside the window, for open tasks, with stable keys", () => {
    const a = vm(timed(atLocalTime("2026-10-25", "10:00"), 30), [{ kind: "before", minutes: 0 }, { kind: "before", minutes: 60 }]);
    const done = vm(timed(atLocalTime("2026-10-25", "10:00"), 30), [{ kind: "before", minutes: 0 }], { status: "done", id: "d" });
    const fires = remindersBetween([a, done], [], () => new Map(), atLocalTime("2026-10-25", "09:30"), atLocalTime("2026-10-25", "10:00"), "24h", 1);
    expect(fires.map((f) => wallKey(f.at))).toEqual(["2026-10-25T10:00"]);
    expect(fires[0].key).toBe(`task:t::${atLocalTime("2026-10-25", "10:00").toISOString()}`);
    expect(fires[0].body).toBe("Today at 10:00");
  });

  it("fires habit reminders only while the habit is still due", () => {
    const h: Habit = { id: "h", name: "Read", icon: "📚", color: "#000", goal: { kind: "once" }, frequency: { kind: "daily" }, reminders: ["20:00"], groupId: null, sortOrder: 0, archived: false, startDate: "2026-01-01", createdAt: "" };
    const win = [atLocalTime("2026-10-25", "19:00"), atLocalTime("2026-10-25", "21:00")] as const;
    expect(remindersBetween([], [h], () => new Map(), ...win, "24h", 1)).toHaveLength(1);
    expect(remindersBetween([], [h], () => new Map([["2026-10-25", 1]]), ...win, "24h", 1)).toHaveLength(0);
  });

  it("alerts when timed tasks and events start, skipping done and all-day items", () => {
    const at = atLocalTime("2026-10-25", "10:00");
    const end = atLocalTime("2026-10-25", "10:30");
    const item = (p: Partial<CalItem>): CalItem => ({ uid: "task:a:", source: "task", id: "a", key: null, title: "Standup", allDay: false, startDate: "2026-10-25", endDate: "2026-10-25", start: at, end, color: "", done: false, recurring: false, readOnly: false, priority: 0, ...p });
    const win = [atLocalTime("2026-10-25", "09:59"), atLocalTime("2026-10-25", "10:00")] as const;
    const fires = startsBetween([item({}), item({ uid: "event:e:", source: "event", id: "e" }), item({ uid: "task:d:", done: true }), item({ uid: "task:x:", allDay: true })], ...win, "24h");
    expect(fires.map((f) => f.target.kind)).toEqual(["task", "event"]);
    expect(fires[0].body).toBe("Starting now · 10:00–10:30");
    // An explicit "at start" reminder on the same task wins over the start alert.
    const explicit = remindersBetween([vm(timed(at, 30), [{ kind: "before", minutes: 0 }], { id: "a" })], [], () => new Map(), ...win, "24h", 1);
    expect(dedupeFires([...explicit, ...fires])).toHaveLength(2);
  });

  it("sends the daily summary once, at its time, only when something is due or overdue", () => {
    const today = vm({ kind: "day", date: "2026-10-25" }, [], { id: "a" });
    const late = vm({ kind: "day", date: "2026-10-20" }, [], { id: "b" });
    const win = [atLocalTime("2026-10-25", "08:00"), atLocalTime("2026-10-25", "09:00")] as const;
    const [f] = digestBetween([today, late], "09:00", ...win);
    expect(f.key).toBe("digest:2026-10-25");
    expect(f.body).toBe("1 due today · 1 overdue");
    expect(digestBetween([today], "09:30", ...win)).toHaveLength(0);
    expect(digestBetween([], "09:00", ...win)).toHaveLength(0);
  });

  it("gathers upcoming fires from every source, soonest first, honouring the settings", () => {
    const a = vm(timed(atLocalTime("2026-10-26", "10:00"), 30), [{ kind: "before", minutes: 0 }], { id: "a" });
    const b = vm({ kind: "day", date: "2026-10-25" }, [{ kind: "dayOf", daysBefore: 0, time: "08:00" }], { id: "b" });
    const src = { active: [a, b], events: [], habits: [], habitValues: () => new Map(), settings: DEFAULT_SETTINGS };
    const win = [atLocalTime("2026-10-25", "07:00"), atLocalTime("2026-11-01", "07:00")] as const;
    const fires = upcomingFires(src, ...win);
    // b's 08:00 reminder, the digests, then a's reminder (its start alert is deduplicated).
    expect(fires.map((f) => f.at.getTime())).toEqual([...fires.map((f) => f.at.getTime())].sort((x, y) => x - y));
    expect(fires[0].target).toEqual({ kind: "task", id: "b", occurrenceKey: null });
    expect(fires.filter((f) => f.target.kind === "task" && f.target.id === "a")).toHaveLength(1);
    // Worded for the moment it fires, even with a week-long window.
    expect(fires.find((f) => f.target.kind === "task" && f.target.id === "a")?.body).toBe("Today at 10:00");
    expect(fires[0].body).toBe("Due today");
    const quiet = { ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, digest: false, starts: false, taskReminders: false } };
    expect(upcomingFires({ ...src, settings: quiet }, ...win)).toHaveLength(0);
    expect(upcomingFires({ ...src, settings: { ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, enabled: false } } }, ...win)).toHaveLength(0);
  });

  describe("streak at risk", () => {
    const habit = (p: Partial<Habit> = {}): Habit => ({ id: "h", name: "Reading", icon: "", color: "#000", goal: { kind: "once" }, frequency: { kind: "daily" }, reminders: [], groupId: null, sortOrder: 0, archived: false, startDate: "2026-01-01", createdAt: "", ...p });
    const days = (...d: string[]) => new Map(d.map((x) => [x, 1]));
    const win = [atLocalTime("2026-10-25", "12:00"), atLocalTime("2026-10-26", "23:00")] as const;

    it("fires at the time on today if a daily streak is not yet saved, and tomorrow", () => {
      const f = streakFires([habit()], () => days("2026-10-24", "2026-10-23"), "18:00", ...win, 0);
      expect(f.map((x) => wallKey(x.at))).toEqual(["2026-10-25T18:00", "2026-10-26T18:00"]);
      expect(f[0].title).toBe("Keep your 2-day Reading streak");
    });

    it("skips today once done, and habits with no streak", () => {
      const f = streakFires([habit()], () => days("2026-10-25", "2026-10-24"), "18:00", ...win, 0);
      expect(f.map((x) => wallKey(x.at))).toEqual(["2026-10-26T18:00"]);
      expect(streakFires([habit()], () => days("2026-10-20"), "18:00", ...win, 0)).toHaveLength(0);
    });

    it("fires weekly habits on the last day of the week, only while the week's target is unmet", () => {
      const h = habit({ frequency: { kind: "perWeek", count: 1 } });
      // Week Mon 2026-10-19..Sun 2026-10-25 done; Mon 26 starts a new week, so Sunday Nov 1 is its last day.
      const long = [atLocalTime("2026-10-26", "12:00"), atLocalTime("2026-11-02", "12:00")] as const;
      expect(streakFires([h], () => days("2026-10-20"), "18:00", ...long, 1).map((x) => wallKey(x.at))).toEqual(["2026-11-01T18:00"]);
      expect(streakFires([h], () => days("2026-10-20", "2026-10-27"), "18:00", ...long, 1)).toHaveLength(0);
    });

    it("combines several habits into one notification", () => {
      const f = streakFires([habit(), habit({ id: "g", name: "Yoga" })], () => days("2026-10-24"), "18:00", ...win, 0);
      expect(f[0].title).toBe("Keep your streaks alive");
      expect(f[0].body).toBe("Reading (1 day), Yoga (1 day)");
    });

    it("is switched off by the setting", () => {
      const src = { active: [], events: [], habits: [habit()], habitValues: () => days("2026-10-24"), settings: { ...DEFAULT_SETTINGS, streakReminder: { on: false, time: "18:00" } } };
      expect(upcomingFires(src, ...win).some((f) => f.key.startsWith("streak:"))).toBe(false);
      expect(upcomingFires({ ...src, settings: DEFAULT_SETTINGS }, ...win).some((f) => f.key.startsWith("streak:"))).toBe(true);
    });
  });
});
