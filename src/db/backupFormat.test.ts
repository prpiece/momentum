import { describe, expect, it } from "vitest";
import { sampleFocus, sampleHabits, sampleWorkspace } from "../dev/seed";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { BACKUP_FORMAT, validateBackup, type BackupFile } from "./backupFormat";
import { habitToRow } from "./habitRows";
import { sessionRow } from "./miscRows";
import { subscriptionToRow, type CalendarSubscription } from "../domain/subscriptions";
import { eventToRow, folderToRow, listToRow, sectionToRow, tagToRow, taskToRow } from "./rows";

const SUB: CalendarSubscription = { id: "sub1", name: "Holidays", url: "https://example.com/h.ics", color: "#2f9358", sortOrder: 1, createdAt: "2026-10-01T00:00:00.000Z", deletedAt: null };

function file(): BackupFile {
  const ws = sampleWorkspace("2026-10-25");
  const h = sampleHabits("2026-10-25");
  return {
    app: "Momentum",
    format: BACKUP_FORMAT,
    schemaVersion: 5,
    exportedAt: "2026-10-25T00:00:00.000Z",
    tables: {
      settings: [{ id: 1, value: JSON.stringify({ ...DEFAULT_SETTINGS, theme: "dark" }) }],
      folders: ws.folders.map(folderToRow),
      lists: [listToRow({ id: "inbox", name: "Inbox", color: null, icon: null, folderId: null, pinned: false, archived: false, tint: false, layout: "list", sortOrder: -1 }), ...ws.lists.map(listToRow)],
      sections: ws.sections.map(sectionToRow),
      tags: ws.tags.map(tagToRow),
      tasks: ws.tasks.map(taskToRow),
      task_activity: [],
      calendar_subscriptions: [subscriptionToRow(SUB)],
      calendar_events: ws.events.map(eventToRow),
      habit_groups: h.groups.map((g) => ({ id: g.id, name: g.name, sort_order: g.sortOrder })),
      habits: h.habits.map(habitToRow),
      habit_checkins: h.checkins.map((c) => ({ habit_id: c.habitId, date: c.date, value: c.value, note: c.note, mood: c.mood })),
      focus_sessions: sampleFocus(ws.tasks, "2026-10-25").map(sessionRow),
    },
  };
}

describe("validateBackup", () => {
  it("round-trips a full export losslessly", () => {
    const f = file();
    const r = validateBackup(JSON.parse(JSON.stringify(f)));
    if (!r.ok) throw new Error(r.error);
    expect(r.dropped).toBe(0);
    expect(r.data.settings?.theme).toBe("dark");
    expect(r.data.tasks).toHaveLength(f.tables.tasks.length);
    expect(r.data.tasks.map(taskToRow)).toEqual(f.tables.tasks);
    expect(r.data.habits.map(habitToRow)).toEqual(f.tables.habits);
  });

  it("carries calendar subscriptions and drops subscribed events whose subscription is gone", () => {
    const f = file();
    const ev = { ...f.tables.calendar_events[0], source: "ics" };
    f.tables.calendar_events = [{ ...ev, id: "sub:sub1:a", subscription_id: "sub1" }, { ...ev, id: "sub:gone:a", subscription_id: "gone" }];
    const r = validateBackup(JSON.parse(JSON.stringify(f)));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.subscriptions).toEqual([SUB]);
    expect(r.data.events.map((e) => e.id)).toEqual(["sub:sub1:a"]);
    expect(r.dropped).toBe(1);
  });

  it("rejects files that aren't Momentum backups or are from the future", () => {
    expect(validateBackup({ hello: 1 }).ok).toBe(false);
    expect(validateBackup({ ...file(), format: BACKUP_FORMAT + 1 }).ok).toBe(false);
  });

  it("repairs dangling references and parent cycles instead of failing", () => {
    const f = file();
    const [a, b, c] = f.tables.tasks;
    f.tables.tasks = [
      { ...a, parent_id: String(b.id) },
      { ...b, parent_id: String(a.id) }, // a <-> b cycle
      { ...c, list_id: "gone", parent_id: "missing", section_id: "nope" },
    ];
    f.tables.lists = f.tables.lists.filter((l) => l.id !== "inbox"); // Inbox missing too
    f.tables.habit_checkins.push({ habit_id: "ghost", date: "2026-10-01", value: 1, note: "", mood: null });
    f.tables.tasks.push({ title: "no id" });
    const r = validateBackup(f);
    if (!r.ok) throw new Error(r.error);
    const [ra, rb, rc] = r.data.tasks;
    expect([ra.parentId, rb.parentId]).toEqual([null, null]);
    expect(rc).toMatchObject({ listId: "inbox", parentId: null, sectionId: null });
    expect(r.data.lists.some((l) => l.id === "inbox")).toBe(true);
    expect(r.data.checkins.some((c) => c.habitId === "ghost")).toBe(false);
    expect(r.dropped).toBe(2); // the id-less task and the orphan check-in
  });
});

describe("DATA-01 tags", () => {
  it("merges tags whose names differ only in case and remaps task tag ids (tags.name is UNIQUE NOCASE)", () => {
    const f = file();
    f.tables.tags = [{ id: "t1", name: "Work", color: null }, { id: "t2", name: "work", color: null }];
    f.tables.tasks = [{ ...f.tables.tasks[0], tags: JSON.stringify(["t2", "t1", "ghost"]) }];
    const r = validateBackup(JSON.parse(JSON.stringify(f)));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.tags.map((t) => t.id)).toEqual(["t1"]);
    expect(r.data.tasks[0].tags).toEqual(["t1"]);
    expect(r.dropped).toBe(0);
  });
});

describe("pre-v1.0 backups", () => {
  it("turn countdowns into all-day events (D163)", () => {
    const f = file();
    const tables = { ...f.tables, countdowns: [{ id: "c1", title: "Trip", date: "2026-12-25", direction: "until", repeat: "yearly", emoji: "✈️", color: "#2f6fed", pinned: 1, created_at: "2026-01-01T00:00:00.000Z" }] };
    const r = validateBackup(JSON.parse(JSON.stringify({ ...f, tables })));
    if (!r.ok) throw new Error(r.error);
    expect(r.dropped).toBe(0);
    expect(r.data.events.find((e) => e.id === "c1")).toMatchObject({ title: "✈️ Trip", schedule: { kind: "day", date: "2026-12-25" }, countdown: "until", pinned: true, recurrence: { rule: "FREQ=YEARLY" } });
  });
});
