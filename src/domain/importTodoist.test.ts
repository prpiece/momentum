import { describe, expect, it } from "vitest";
import { parseExternalImport } from "./importExternal";
import { parseTodoist, todoistRepeat } from "./importTodoist";
import { isValidRule } from "./recurrence";

const TODAY = "2025-03-05"; // a Wednesday

const CSV = `TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG
meta,view_style=list,,,,,,,,,,,,
task,Plan trip @travel @urgent,"Book flights,
hotels",1,1,Me (1),,2025-03-10 14:00,en,America/New_York,45,minute,2025-03-20,en
task,Book flights,,2,2,Me (1),,2025-03-08,en,,,,,
task,Deep subtask,,4,3,Me (1),,,,,,,,
note,Prefer the morning one,,,,,,,,,,,,
,,,,,,,,,,,,,
section,Chores,,,,,,,,,,,,
task,Water plants,,4,1,Me (1),,every monday at 9am,en,,,,,
task,Pay rent,,3,1,Me (1),,every 3rd friday,en,,,,,
task,Stretch,,4,1,Me (1),,every day,en,,30,minute,,
task,,,4,1,,,,,,,,,
`;

describe("todoistRepeat", () => {
  it("maps the common phrases to valid rules", () => {
    const cases: [string, string, string | null][] = [
      ["every day", "FREQ=DAILY", null],
      ["every week", "FREQ=WEEKLY", null],
      ["every 2 weeks", "FREQ=WEEKLY;INTERVAL=2", null],
      ["every other month", "FREQ=MONTHLY;INTERVAL=2", null],
      ["every year", "FREQ=YEARLY", null],
      ["every weekday", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", null],
      ["every monday", "FREQ=WEEKLY;BYDAY=MO", null],
      ["every mon, wed and fri at 6:30pm", "FREQ=WEEKLY;BYDAY=MO,WE,FR", "18:30"],
      ["every! day", "FREQ=DAILY", null],
    ];
    for (const [text, rule, time] of cases) {
      expect(todoistRepeat(text), text).toEqual({ rule, time });
      expect(isValidRule(rule)).toBe(true);
    }
  });
  it("gives up on the rest", () => {
    for (const t of ["every 3rd friday", "every day starting aug 3", "every last day", "tomorrow", ""]) expect(todoistRepeat(t), t).toBeNull();
  });
});

describe("Todoist CSV", () => {
  const plan = parseTodoist(CSV, "Home", TODAY);
  it("builds a list, a section, subtasks and notes", () => {
    expect(plan).not.toBeNull();
    expect(plan!.lists).toEqual([{ id: "l1", name: "Home", folder: null }]);
    expect(plan!.sections.map((s) => s.name)).toEqual(["Chores"]);
    const [trip, flights, deep, water] = plan!.tasks;
    expect(trip.title).toBe("Plan trip");
    expect(trip.tags).toEqual(["travel", "urgent"]);
    expect(trip.description).toBe("Book flights,\nhotels");
    expect(flights.parent).toBe(trip.id);
    expect(deep.parent).toBe(flights.id);
    expect(deep.description).toBe("Prefer the morning one");
    expect(water.section).toBe("s1");
  });
  it("maps priority (CSV 1 is p1, the highest), dates, durations and deadlines", () => {
    const [trip, flights, deep] = plan!.tasks;
    expect([trip.priority, flights.priority, deep.priority]).toEqual([3, 2, 0]);
    expect(trip.schedule.kind).toBe("timed");
    if (trip.schedule.kind === "timed") expect(Date.parse(trip.schedule.end) - Date.parse(trip.schedule.start)).toBe(45 * 60000);
    expect(trip.deadline).toBe("2025-03-20");
    expect(flights.schedule).toEqual({ kind: "day", date: "2025-03-08" });
  });
  it("keeps the repeats it can and counts the ones it can't", () => {
    const water = plan!.tasks.find((t) => t.title === "Water plants")!;
    expect(water.rule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(water.schedule.kind).toBe("timed"); // next Monday, 9:00
    const rent = plan!.tasks.find((t) => t.title === "Pay rent")!;
    expect(rent.rule).toBeNull();
    const stretch = plan!.tasks.find((t) => t.title === "Stretch")!;
    expect(stretch.rule).toBe("FREQ=DAILY");
    expect(stretch.schedule).toEqual({ kind: "day", date: TODAY });
    expect(stretch.durationMin).toBe(30);
    expect(plan!.counts).toMatchObject({ lists: 1, sections: 1, tasks: 6, subtasks: 2, tags: 2, completed: 0, repeatsKept: 2, repeatsNotKept: 1, skipped: 1 });
  });
});

describe("Todoist JSON", () => {
  const json = JSON.stringify({
    projects: [{ id: "p1", name: "Work" }, { id: "p2", name: "Old", is_archived: true }],
    sections: [{ id: "s1", project_id: "p1", name: "Doing" }],
    items: [
      { id: "1", project_id: "p1", section_id: "s1", content: "Ship it", description: "now", priority: 4, labels: ["a", "b"], due: { date: "2025-03-07T15:00:00", is_recurring: true, string: "every 2 weeks" }, deadline: { date: "2025-03-09" }, duration: { amount: 2, unit: "day" } },
      { id: "2", project_id: "p1", parent_id: "1", content: "Sub", priority: 2, checked: true, completed_at: "2025-03-01T10:00:00Z" },
      { id: "3", project_id: "p1", parent_id: "3", content: "Self parent" },
      { id: "4", project_id: "p2", content: "Archived" },
      { id: "5", project_id: "p1", content: "  " },
      { id: "6", project_id: "p1", content: "Weird repeat", due: { date: "2025-03-07", is_recurring: true, string: "every 3rd friday" } },
      "junk",
    ],
  });
  it("imports projects, sections, subtasks, priorities (API 4 is p1) and completion", () => {
    const plan = parseExternalImport(json, "x");
    expect(plan.ok && plan.source).toBe("todoist");
    if (!plan.ok) return;
    const p = plan.plan;
    expect(p.lists.map((l) => l.name)).toEqual(["Work"]);
    const [ship, sub, selfParent] = p.tasks;
    expect([ship.priority, sub.priority]).toEqual([3, 1]);
    expect(ship.rule).toBe("FREQ=WEEKLY;INTERVAL=2");
    expect(ship.section).toBe("s1");
    expect(ship.deadline).toBe("2025-03-09");
    expect(sub).toMatchObject({ parent: ship.id, status: "done", completedAt: "2025-03-01T10:00:00.000Z" });
    expect(selfParent.parent).toBeNull();
    expect(p.counts).toMatchObject({ tasks: 4, subtasks: 1, completed: 1, repeatsKept: 1, repeatsNotKept: 1, skipped: 3 });
  });
});

describe("boundaries", () => {
  it("never throws and explains what it can't read", () => {
    for (const bad of ["", "{", "[1,2]", '{"items":"no"}', "just text", "TYPE,CONTENT\n", "\u0000\u0001"]) {
      const r = parseExternalImport(bad);
      expect(r.ok).toBe(false);
    }
  });
});

describe("v1.2.4 import fixes", () => {
  it("DATA-09: a hostile priority cell like constructor or __proto__ is no priority", () => {
    const csv = `TYPE,CONTENT,PRIORITY,INDENT
task,A,constructor,1
task,B,__proto__,1
`;
    expect(parseTodoist(csv, "x", TODAY)!.tasks.map((t) => t.priority)).toEqual([0, 0]);
    const json = JSON.stringify({ items: [{ id: "1", content: "A", priority: "constructor" }] });
    const r = parseExternalImport(json, "x");
    expect(r.ok && r.plan.tasks[0].priority).toBe(0);
  });
  it("DATA-10: JSON items follow child_order, sections section_order, and the inbox project maps to Inbox", () => {
    const json = JSON.stringify({
      projects: [{ id: "i", name: "Inbox", inbox_project: true }],
      sections: [{ id: "s2", project_id: "i", name: "Second", section_order: 2 }, { id: "s1", project_id: "i", name: "First", section_order: 1 }],
      items: [{ id: "a", project_id: "i", content: "a", child_order: 2 }, { id: "b", project_id: "i", content: "b", child_order: 1 }],
    });
    const r = parseExternalImport(json, "x");
    if (!r.ok) throw new Error("no plan");
    expect(r.plan.tasks.map((t) => t.title)).toEqual(["b", "a"]);
    expect(r.plan.sections.map((s) => s.name)).toEqual(["First", "Second"]);
    expect(r.plan.lists).toEqual([{ id: "l1", name: "Inbox", folder: null, inbox: true }]);
  });
  it("DATA-03: a 7-level import nests at most 5 deep", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ id: `${i}`, content: `L${i}`, ...(i ? { parent_id: `${i - 1}` } : {}) }));
    const r = parseExternalImport(JSON.stringify({ items }), "x");
    if (!r.ok) throw new Error("no plan");
    const byId = new Map(r.plan.tasks.map((t) => [t.id, t]));
    const depth = (id: string): number => { const p = byId.get(id)!.parent; return p ? 1 + depth(p) : 1; };
    expect(Math.max(...r.plan.tasks.map((t) => depth(t.id)))).toBe(5);
  });
});
