import { describe, expect, it } from "vitest";
import { sampleCountdowns, sampleFocus, sampleHabits, sampleWorkspace } from "../dev/seed";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { BACKUP_FORMAT, validateBackup, type BackupFile } from "./backupFormat";
import { habitToRow } from "./habitRows";
import { countdownRow, sessionRow } from "./miscRows";
import { eventToRow, folderToRow, listToRow, sectionToRow, tagToRow, taskToRow } from "./rows";

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
      lists: [listToRow({ id: "inbox", name: "Inbox", color: null, emoji: null, folderId: null, pinned: false, archived: false, tint: false, layout: "list", sortOrder: -1 }), ...ws.lists.map(listToRow)],
      sections: ws.sections.map(sectionToRow),
      tags: ws.tags.map(tagToRow),
      tasks: ws.tasks.map(taskToRow),
      task_activity: [],
      calendar_events: ws.events.map(eventToRow),
      habit_groups: h.groups.map((g) => ({ id: g.id, name: g.name, sort_order: g.sortOrder })),
      habits: h.habits.map(habitToRow),
      habit_checkins: h.checkins.map((c) => ({ habit_id: c.habitId, date: c.date, value: c.value, note: c.note, mood: c.mood })),
      countdowns: sampleCountdowns("2026-10-25").map(countdownRow),
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
