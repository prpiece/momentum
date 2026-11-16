import ICAL from "ical.js";
import { clean, finalize, keepRule, type ImportPlan, type PlanTask, type Skipped } from "./importPlan";
import type { Priority, Schedule } from "./types";

/*
 * VTODO import: the .ics that Apple Reminders (File → Export), Outlook and Thunderbird write for tasks.
 * SUMMARY, DESCRIPTION, DUE (or DTSTART), STATUS, COMPLETED, PRIORITY (1-4 high, 5 medium, 6-9 low), RRULE,
 * CATEGORIES (tags) and RELATED-TO (parent). Everything goes into one list named by the calendar or the file.
 */

const PRIORITY = (n: number): Priority => (n >= 1 && n <= 4 ? 3 : n === 5 ? 2 : n >= 6 && n <= 9 ? 1 : 0);

function scheduleOf(t: InstanceType<typeof ICAL.Time> | null): Schedule {
  if (!t) return { kind: "none" };
  if (t.isDate) return { kind: "day", date: `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` };
  const d = t.toJSDate();
  const start = d.toISOString();
  return { kind: "timed", start, end: new Date(d.getTime() + 3_600_000).toISOString() };
}

/** Returns null when the text isn't an iCalendar file or has no VTODO. */
export function parseVtodo(text: string, name = "Reminders"): ImportPlan | null {
  const root = new ICAL.Component(ICAL.parse(text));
  const todos = root.getAllSubcomponents("vtodo");
  if (!todos.length) return null;
  const tasks: PlanTask[] = [];
  const skipped: Skipped[] = [];
  let repeatsNotKept = 0;
  todos.forEach((c, i) => {
    const title = clean(String(c.getFirstPropertyValue("summary") ?? ""));
    if (!title) return void skipped.push({ line: null, reason: "task without a title" });
    const val = (p: string) => c.getFirstPropertyValue(p);
    const time = (p: string) => {
      const v = val(p);
      return v instanceof ICAL.Time ? v : null;
    };
    const schedule = scheduleOf(time("due") ?? time("dtstart"));
    const rrule = val("rrule");
    const rule = rrule ? keepRule(String(rrule), schedule) : null;
    if (rrule && !rule) repeatsNotKept++;
    const status = String(val("status") ?? "").toUpperCase();
    const done = status === "COMPLETED" || !!time("completed");
    const completed = time("completed")?.toJSDate();
    tasks.push({
      id: String(val("uid") ?? `t${i}`),
      parent: String(c.getFirstProperty("related-to")?.getFirstValue() ?? "") || null,
      list: "l1",
      section: null,
      title,
      description: String(val("description") ?? "").trim(),
      priority: PRIORITY(Number(val("priority") ?? 0)),
      status: status === "CANCELLED" ? "wont_do" : done ? "done" : "open",
      schedule,
      deadline: null,
      durationMin: null,
      rule,
      tags: c.getAllProperties("categories").flatMap((p) => p.getValues().map((v) => clean(String(v)))).filter(Boolean),
      checklist: [],
      completedAt: done ? (completed ?? new Date()).toISOString() : null,
    });
  });
  if (!tasks.length) return null;
  const listName = clean(String(root.getFirstPropertyValue("x-wr-calname") ?? "")) || name;
  return finalize({ lists: [{ id: "l1", name: listName, folder: null }], sections: [], tasks, skipped, repeatsNotKept });
}
