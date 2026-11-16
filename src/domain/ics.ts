/*
 * One-time, read-only .ics import (e.g. a Google Calendar export). Uses ical.js for the hard
 * parts: line unfolding, VTIMEZONE definitions, RRULE/EXDATE/RECURRENCE-ID. Pure; unit-tested.
 */
import ICAL from "ical.js";
import { atLocalTime, daysBetween, durationMinutes, fromWall, hhmm, isZone, timed, wallIn, wallKey } from "./dates";
import { isValidRule } from "./recurrence";
import type { CalendarEvent, Schedule, Task } from "./types";

type ICALTime = InstanceType<typeof ICAL.Time>;

const localDateOf = (t: ICALTime) => `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;

const floatingOf = (t: ICALTime) => new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second));
const icsStamp = (f: Date) => f.toISOString().slice(0, 19).replace(/[-:]/g, "");

/** The zone of a DATE-TIME: UTC, or an IANA TZID even without a VTIMEZONE block (TIME-06). Null when floating or not IANA. */
function zoneOf(t: ICALTime, tzid: unknown): string | null {
  if (t.isDate) return null;
  if (t.zone?.tzid === "UTC") return "UTC";
  return typeof tzid === "string" && isZone(tzid) ? tzid : null;
}

function instantOf(t: ICALTime, tzid: unknown): Date {
  const z = zoneOf(t, tzid);
  return z ? fromWall(floatingOf(t), z) : t.toJSDate();
}

/** Occurrence key in Momentum's format for an ICS time (matches recurrence.ts keys). */
function keyOf(t: ICALTime, tzid: unknown): string {
  return t.isDate ? localDateOf(t) : wallKey(instantOf(t, tzid));
}

const BAD_RULE = "X-MOMENTUM-BAD-RRULE";

/** ICAL.parse, but one RRULE ical.js can't read only loses its own event, not the whole file (TIME-12). */
function parseCalendar(text: string): ReturnType<typeof ICAL.parse> {
  try {
    return ICAL.parse(text);
  } catch (err) {
    const fixed = text.replace(/^RRULE:(.*)$/gim, (line, value: string) => {
      try {
        ICAL.Recur.fromString(value.trim());
        return line;
      } catch {
        return `${BAD_RULE}:1`;
      }
    });
    if (fixed === text) throw err;
    return ICAL.parse(fixed);
  }
}

export type IcsResult = { events: CalendarEvent[]; skipped: number };

/**
 * Parse VEVENTs into read-only events. IDs derive from UID (+ RECURRENCE-ID), so importing the
 * same file again updates instead of duplicating. Modified instances of a series become
 * standalone events and their original slot is excluded from the series.
 */
export function parseIcs(text: string, color: string, now = new Date().toISOString()): IcsResult {
  const root = new ICAL.Component(parseCalendar(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const byId = new Map<string, CalendarEvent>();
  const overrides: { parentId: string; key: string }[] = [];
  let skipped = 0;

  for (const comp of root.getAllSubcomponents("vevent")) {
    try {
      const e = new ICAL.Event(comp);
      const start = e.startDate;
      if (!start || comp.hasProperty(BAD_RULE.toLowerCase())) {
        skipped++;
        continue;
      }
      const uid = e.uid || `${e.summary}-${start.toString()}`;
      const recId = e.recurrenceId;
      const tzidOf = (name: string) => comp.getFirstProperty(name)?.getParameter("tzid");
      const recKey = recId && keyOf(recId, tzidOf("recurrence-id"));
      const id = recKey ? `ics:${uid}:${recKey}` : `ics:${uid}`;
      const zone = zoneOf(start, tzidOf("dtstart"));
      let schedule: Schedule;
      let spanDays = 1;
      if (start.isDate) {
        const date = localDateOf(start);
        const end = e.endDate && e.endDate.isDate ? localDateOf(e.endDate) : date;
        spanDays = Math.max(1, daysBetween(date, end));
        schedule = { kind: "day", date };
      } else {
        const s = instantOf(start, tzidOf("dtstart"));
        const end = e.endDate ? instantOf(e.endDate, tzidOf("dtend")) : new Date(s.getTime() + 3_600_000);
        schedule = timed(s, Math.max(1, Math.round((end.getTime() - s.getTime()) / 60_000)));
      }

      let recurrence: CalendarEvent["recurrence"] = null;
      const rrule = comp.getFirstPropertyValue("rrule");
      if (!recId && rrule) {
        let rule = String(rrule);
        // A zoned series expands in its own zone (TIME-04); its UTC UNTIL becomes that zone's wall clock (TIME-05).
        if (zone && schedule.kind === "timed") {
          const z = zone;
          rule = rule.replace(/UNTIL=(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/i, (_, y, mo, d, h, mi, se) => `UNTIL=${icsStamp(wallIn(new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`), z))}`);
          rule = `DTSTART;TZID=${zone}:${icsStamp(floatingOf(start))}\nRRULE:${rule}`;
        }
        const s = schedule;
        // A DATE exdate on a timed series excludes that day's occurrence (TIME-13).
        const exKey = (v: ICALTime, tzid: unknown) =>
          v.isDate && s.kind === "timed"
            ? wallKey(zone ? fromWall(new Date(Date.UTC(v.year, v.month - 1, v.day, start.hour, start.minute, start.second)), zone) : atLocalTime(localDateOf(v), hhmm(new Date(s.start))))
            : keyOf(v, tzid);
        const exdates = comp.getAllProperties("exdate").flatMap((p) => p.getValues().flatMap((v) => (v instanceof ICAL.Time ? [exKey(v, p.getParameter("tzid"))] : [])));
        if (isValidRule(rule)) recurrence = { rule, exdates };
      }
      if (recKey) overrides.push({ parentId: `ics:${uid}`, key: recKey });

      const ev: CalendarEvent = {
        id,
        title: e.summary || "Untitled event",
        countdown: null,
        pinned: false,
        notes: [e.location, e.description].filter(Boolean).join("\n\n"),
        schedule,
        spanDays,
        color,
        recurrence,
        recurrenceParentId: recId ? `ics:${uid}` : null,
        source: "ics",
        subscriptionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      byId.set(id, ev);
      // RDATEs are extra one-off instances (TIME-17); an override with the same RECURRENCE-ID wins.
      if (recurrence) {
        for (const p of comp.getAllProperties("rdate")) {
          for (const v of p.getValues()) {
            if (!(v instanceof ICAL.Time) || v.isDate !== start.isDate) continue;
            const key = keyOf(v, p.getParameter("tzid"));
            const rid = `ics:${uid}:${key}`;
            if (byId.has(rid)) continue;
            const one: Schedule = schedule.kind === "timed" ? timed(instantOf(v, p.getParameter("tzid")), durationMinutes(schedule) ?? 60) : { kind: "day", date: key };
            byId.set(rid, { ...ev, id: rid, schedule: one, recurrence: null, recurrenceParentId: ev.id });
          }
        }
      }
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


// ---- Export (FEAT-05): a one-way .ics of dated tasks and own events, for other calendar apps ----

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n|\r/g, "\\n");

/** RFC 5545 §3.1: lines over 75 octets continue on the next line after a space; never splits a UTF-8 character. */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const utcStamp = (d: Date) => d.toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
const dateStamp = (date: string, plusDays = 0) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + plusDays)).toISOString().slice(0, 10).replace(/-/g, "");
};

type Exportable = { id: string; title: string; notes: string; schedule: Schedule; spanDays: number; rule: string | null };

function vevent(x: Exportable, stamp: string): string[] | null {
  const s = x.schedule;
  if (s.kind !== "day" && s.kind !== "timed") return null;
  const when =
    s.kind === "day"
      ? [`DTSTART;VALUE=DATE:${dateStamp(s.date)}`, `DTEND;VALUE=DATE:${dateStamp(s.date, Math.max(1, x.spanDays))}`]
      : [`DTSTART:${utcStamp(new Date(s.start))}`, `DTEND:${utcStamp(new Date(s.end))}`];
  // ponytail: a repeat is exported as its RRULE only; skipped occurrences (exdates) and DST drift of timed repeats aren't carried.
  const rrule = x.rule && (x.rule.split("\n").find((l) => /^RRULE:/i.test(l))?.slice(6) ?? (/^FREQ=/i.test(x.rule) ? x.rule : null));
  return ["BEGIN:VEVENT", `UID:${x.id}@momentum`, `DTSTAMP:${stamp}`, ...when, `SUMMARY:${icsText(x.title)}`, ...(x.notes ? [`DESCRIPTION:${icsText(x.notes)}`] : []), ...(rrule ? [`RRULE:${rrule}`] : []), "END:VEVENT"];
}

/** Open tasks with a day or time, and own (non-imported) events, as an RFC 5545 calendar: UTC for timed, floating DATEs for all-day. */
export function toIcs(tasks: Task[], events: CalendarEvent[], now = new Date()): string {
  const stamp = utcStamp(now);
  const items: Exportable[] = [
    ...tasks.filter((t) => !t.deletedAt && t.status === "open").map((t) => ({ id: t.id, title: t.title, notes: t.description, schedule: t.schedule, spanDays: 1, rule: t.recurrence?.rule ?? null })),
    ...events.filter((e) => !e.deletedAt && e.source === "local").map((e) => ({ id: e.id, title: e.title, notes: e.notes, schedule: e.schedule, spanDays: e.spanDays, rule: e.recurrence?.rule ?? null })),
  ];
  const body = items.flatMap((x) => vevent(x, stamp) ?? []);
  return [...["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Momentum//Planner//EN", "CALSCALE:GREGORIAN"], ...body, "END:VCALENDAR"].map(foldIcsLine).join("\r\n") + "\r\n";
}
