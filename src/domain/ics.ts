/*
 * One-time, read-only .ics import (e.g. a Google Calendar export). Uses ical.js for the hard
 * parts: line unfolding, VTIMEZONE definitions, RRULE/EXDATE/RECURRENCE-ID. Pure; unit-tested.
 */
import ICAL from "ical.js";
import { daysBetween, timed, wallKey } from "./dates";
import { isValidRule } from "./recurrence";
import type { CalendarEvent, Schedule } from "./types";

type ICALTime = InstanceType<typeof ICAL.Time>;

const localDateOf = (t: ICALTime) => `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;

/** Occurrence key in Momentum's format for an ICS time (matches recurrence.ts keys). */
function keyOf(t: ICALTime): string {
  return t.isDate ? localDateOf(t) : wallKey(t.toJSDate());
}

export type IcsResult = { events: CalendarEvent[]; skipped: number };

/**
 * Parse VEVENTs into read-only events. IDs derive from UID (+ RECURRENCE-ID), so importing the
 * same file again updates instead of duplicating. Modified instances of a series become
 * standalone events and their original slot is excluded from the series.
 */
export function parseIcs(text: string, color: string, now = new Date().toISOString()): IcsResult {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const byId = new Map<string, CalendarEvent>();
  const overrides: { parentId: string; key: string }[] = [];
  let skipped = 0;

  for (const comp of root.getAllSubcomponents("vevent")) {
    try {
      const e = new ICAL.Event(comp);
      const start = e.startDate;
      if (!start) {
        skipped++;
        continue;
      }
      const uid = e.uid || `${e.summary}-${start.toString()}`;
      const recId = e.recurrenceId;
      const id = recId ? `ics:${uid}:${keyOf(recId)}` : `ics:${uid}`;
      let schedule: Schedule;
      let spanDays = 1;
      if (start.isDate) {
        const date = localDateOf(start);
        const end = e.endDate && e.endDate.isDate ? localDateOf(e.endDate) : date;
        spanDays = Math.max(1, daysBetween(date, end));
        schedule = { kind: "day", date };
      } else {
        const s = start.toJSDate();
        const end = e.endDate ? e.endDate.toJSDate() : new Date(s.getTime() + 3_600_000);
        schedule = timed(s, Math.max(1, Math.round((end.getTime() - s.getTime()) / 60_000)));
      }

      let recurrence: CalendarEvent["recurrence"] = null;
      const rrule = comp.getFirstPropertyValue("rrule");
      if (!recId && rrule) {
        const rule = String(rrule);
        const exdates = comp.getAllProperties("exdate").flatMap((p) => p.getValues().flatMap((v) => (v instanceof ICAL.Time ? [keyOf(v)] : [])));
        if (isValidRule(rule)) recurrence = { rule, exdates };
      }
      if (recId) overrides.push({ parentId: `ics:${uid}`, key: keyOf(recId) });

      byId.set(id, {
        id,
        title: e.summary || "Untitled event",
        notes: [e.location, e.description].filter(Boolean).join("\n\n"),
        schedule,
        spanDays,
        color,
        recurrence,
        recurrenceParentId: recId ? `ics:${uid}` : null,
        source: "ics",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    } catch {
      skipped++;
    }
  }

  for (const o of overrides) {
    const parent = byId.get(o.parentId);
    if (parent?.recurrence && !parent.recurrence.exdates.includes(o.key)) parent.recurrence.exdates.push(o.key);
  }
  // A modified instance whose series isn't in the file is simply a standalone event.
  for (const ev of byId.values()) if (ev.recurrenceParentId && !byId.has(ev.recurrenceParentId)) ev.recurrenceParentId = null;

  return { events: [...byId.values()], skipped };
}

