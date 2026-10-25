import { RRule, type Options } from "rrule";
import { addDaysLocal, atLocalTime, daysBetween, durationMinutes, fromLocalDate, hhmm, scheduleDate, timed } from "./dates";
import type { Recurrence, Schedule, Task } from "./types";

/*
 * Floating wall-clock recurrence. rrule works in UTC, so local wall-clock components are
 * smuggled through as UTC fields ("floating" dates) and read back the same way. A series
 * anchored at 09:00 therefore stays at 09:00 local on both sides of a DST change.
 * Occurrence keys are those wall-clock components as text, so they never shift either.
 */

const toFloating = (d: Date) =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));

type Recurring = Pick<Task, "schedule" | "recurrence">;
export type Occurrence = { key: string; schedule: Schedule };

const MAX_SCAN = 20000;

export function isValidRule(rule: string): boolean {
  try {
    return RRule.parseString(rule).freq !== undefined;
  } catch {
    return false;
  }
}

function anchorOf(s: Schedule): Date | null {
  if (s.kind === "day") return fromLocalDate(s.date);
  if (s.kind === "timed") return new Date(s.start);
  return null;
}

function parse(rule: string): Partial<Options> {
  const { dtstart: _d, tzid: _t, ...opts } = RRule.parseString(rule);
  return opts;
}

function build(rule: string, anchor: Date): RRule {
  return new RRule({ ...parse(rule), dtstart: toFloating(anchor), tzid: null });
}

function serialize(opts: Partial<Options>): string {
  return RRule.optionsToString({ ...opts, dtstart: null, tzid: null }).replace(/^RRULE:/, "");
}

/** `YYYY-MM-DD` for day schedules, `YYYY-MM-DDTHH:mm` for timed ones. */
function keyOf(kind: Schedule["kind"], floating: Date): string {
  return floating.toISOString().slice(0, kind === "timed" ? 16 : 10);
}

function floatingOfKey(key: string): Date {
  return new Date(`${key.length === 10 ? `${key}T00:00` : key}:00.000Z`);
}

/** The schedule a given occurrence of a series has (same duration as the anchor). */
export function scheduleForKey(base: Schedule, key: string): Schedule {
  if (base.kind === "day") return { kind: "day", date: key.slice(0, 10) };
  if (base.kind === "timed") return timed(atLocalTime(key.slice(0, 10), key.slice(11, 16)), durationMinutes(base) ?? 0);
  return base;
}

function occurrence(base: Schedule, floating: Date): Occurrence {
  const key = keyOf(base.kind, floating);
  return { key, schedule: scheduleForKey(base, key) };
}

/** Occurrences overlapping [from, to], minus exdates. Empty for non-recurring tasks. */
export function occurrencesBetween(t: Recurring, from: Date, to: Date): Occurrence[] {
  const anchor = anchorOf(t.schedule);
  if (!anchor || !t.recurrence) return [];
  const dur = durationMinutes(t.schedule) ?? 0;
  const ex = new Set(t.recurrence.exdates);
  return build(t.recurrence.rule, anchor)
    .between(toFloating(new Date(from.getTime() - dur * 60_000)), toFloating(to), true)
    .map((f) => occurrence(t.schedule, f))
    .filter((o) => !ex.has(o.key));
}

/** First occurrence (at or after `from`, default: the series start) that isn't excluded. */
export function nextOccurrence(t: Recurring, from?: Date): Occurrence | null {
  const anchor = anchorOf(t.schedule);
  if (!anchor || !t.recurrence) return null;
  const ex = new Set(t.recurrence.exdates);
  const min = from ? toFloating(from) : null;
  let found: Date | null = null;
  build(t.recurrence.rule, anchor).all((f, i) => {
    if (i > MAX_SCAN) return false;
    if (min && f < min) return true;
    if (ex.has(keyOf(t.schedule.kind, f))) return true;
    found = f;
    return false;
  });
  return found ? occurrence(t.schedule, found) : null;
}

/**
 * What a task looks like right now in list views: its own schedule, or for a series the
 * current (first not-yet-handled) occurrence. `null` means the series has run out.
 */
export function effective(t: Task): { schedule: Schedule; key: string | null } | null {
  if (!t.recurrence || t.schedule.kind === "none") return { schedule: t.schedule, key: null };
  const next = nextOccurrence(t);
  return next ? { schedule: next.schedule, key: next.key } : null;
}

/** "This occurrence": exclude it from the series and return it as a standalone task. */
export function detachOccurrence(series: Task, key: string, newId: string, now: string): { series: Task; single: Task } {
  const rec: Recurrence = series.recurrence ?? { rule: "", exdates: [] };
  return {
    series: { ...series, recurrence: { ...rec, exdates: [...new Set([...rec.exdates, key])] }, updatedAt: now },
    single: {
      ...series,
      id: newId,
      recurrence: null,
      recurrenceParentId: series.id,
      schedule: scheduleForKey(series.schedule, key),
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * "This and following": end the series just before `key` and start a new series there.
 * `head` is null when `key` is the first occurrence (the whole series is "following").
 */
export function splitSeries(series: Task, key: string, newId: string, now: string): { head: Task | null; tail: Task } {
  const rec = series.recurrence;
  const anchor = anchorOf(series.schedule);
  if (!rec || !anchor) return { head: null, tail: series };
  const opts = parse(rec.rule);
  const cut = floatingOfKey(key);
  let before = 0;
  build(rec.rule, anchor).all((f, i) => {
    if (i > MAX_SCAN || f >= cut) return false;
    before++;
    return true;
  });

  const tail: Task = {
    ...series,
    id: newId,
    schedule: scheduleForKey(series.schedule, key),
    recurrence: {
      rule: serialize(opts.count ? { ...opts, count: opts.count - before } : opts),
      exdates: rec.exdates.filter((k) => k >= key),
    },
    createdAt: now,
    updatedAt: now,
  };
  if (before === 0) return { head: null, tail };

  const headOpts = opts.count ? { ...opts, count: before } : { ...opts, until: new Date(cut.getTime() - 60_000) };
  const head: Task = {
    ...series,
    recurrence: { rule: serialize(headOpts), exdates: rec.exdates.filter((k) => k < key) },
    updatedAt: now,
  };
  return { head, tail };
}

export function describeRule(rule: string): string {
  if (!isValidRule(rule)) return "Custom";
  const text = new RRule(parse(rule)).toText();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const REPEAT_PRESETS = [
  { label: "Daily", rule: "FREQ=DAILY" },
  { label: "Weekdays", rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { label: "Weekly", rule: "FREQ=WEEKLY" },
  { label: "Every 2 weeks", rule: "FREQ=WEEKLY;INTERVAL=2" },
  { label: "Monthly", rule: "FREQ=MONTHLY" },
  { label: "Yearly", rule: "FREQ=YEARLY" },
] as const;

/**
 * "All occurrences": the user moved one occurrence from `from` to `to`; move the series anchor
 * by the same number of days, adopting the new wall-clock time and duration.
 */
export function shiftAnchor(anchor: Schedule, from: Schedule, to: Schedule): Schedule {
  const a = scheduleDate(anchor);
  const f = scheduleDate(from);
  const t = scheduleDate(to);
  if (!a || !f || !t || to.kind === "none") return anchor;
  const date = addDaysLocal(a, daysBetween(f, t));
  if (to.kind === "day") return { kind: "day", date };
  return timed(atLocalTime(date, hhmm(new Date(to.start))), durationMinutes(to) ?? 0);
}
