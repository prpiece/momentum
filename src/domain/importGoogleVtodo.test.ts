import { describe, expect, it } from "vitest";
import { parseExternalImport } from "./importExternal";

const google = JSON.stringify({
  kind: "tasks#taskLists",
  items: [
    {
      kind: "tasks#taskList",
      title: "My Tasks",
      items: [
        { kind: "tasks#task", id: "a", title: "Pay rent", notes: "online", status: "needsAction", due: "2026-12-01T00:00:00.000Z" },
        { kind: "tasks#task", id: "b", title: "Sub", parent: "a", status: "completed", completed: "2026-11-01T10:00:00.000Z" },
        { kind: "tasks#task", id: "c", title: "" },
      ],
    },
  ],
});

describe("Google Tasks JSON", () => {
  const r = parseExternalImport(google);
  it("maps lists, due dates, notes, parents and completion", () => {
    expect(r.ok && r.source).toBe("google");
    if (!r.ok) return;
    expect(r.plan.lists[0].name).toBe("My Tasks");
    expect(r.plan.tasks.find((t) => t.title === "Pay rent")).toMatchObject({ description: "online", schedule: { kind: "day", date: "2026-12-01" } });
    expect(r.plan.tasks.find((t) => t.title === "Sub")).toMatchObject({ parent: "a", status: "done", completedAt: "2026-11-01T10:00:00.000Z" });
    expect(r.plan.skipped).toHaveLength(1);
  });
  it("rejects a Takeout file with no tasks", () => {
    expect(parseExternalImport(JSON.stringify({ kind: "tasks#taskLists", items: [] })).ok).toBe(false);
  });
});

describe("VTODO .ics", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "X-WR-CALNAME:Groceries",
    "BEGIN:VTODO",
    "UID:1",
    "SUMMARY:Milk",
    "DUE;VALUE=DATE:20261120",
    "PRIORITY:1",
    "RRULE:FREQ=WEEKLY",
    "CATEGORIES:shop,food",
    "END:VTODO",
    "BEGIN:VTODO",
    "UID:2",
    "SUMMARY:Done thing",
    "STATUS:COMPLETED",
    "COMPLETED:20261101T100000Z",
    "RELATED-TO:1",
    "END:VTODO",
    "END:VCALENDAR",
  ].join("\r\n");
  it("maps list name, priority, repeat, tags, parent and completion", () => {
    const r = parseExternalImport(ics);
    expect(r.ok && r.source).toBe("reminders");
    if (!r.ok) return;
    expect(r.plan.lists[0].name).toBe("Groceries");
    expect(r.plan.tasks.find((t) => t.title === "Milk")).toMatchObject({ priority: 3, rule: "FREQ=WEEKLY", tags: ["shop", "food"], schedule: { kind: "day", date: "2026-11-20" } });
    expect(r.plan.tasks.find((t) => t.title === "Done thing")).toMatchObject({ status: "done", parent: "1" });
  });
  it("says so when a calendar has no tasks", () => {
    expect(parseExternalImport("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR").ok).toBe(false);
  });
});
