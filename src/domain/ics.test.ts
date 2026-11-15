/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { atLocalTime, durationMinutes, wallKey } from "./dates";
import { parseIcs } from "./ics";
import { occurrencesBetween } from "./recurrence";

// TZ=America/New_York. The file uses Europe/London (BST until Oct 25 2026, 02:00 local).
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
TZNAME:BST
DTSTART:19700329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
TZNAME:GMT
DTSTART:19701025T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:standup@example.com
SUMMARY:Standup
DTSTART;TZID=Europe/London:20261019T100000
DTEND;TZID=Europe/London:20261019T101500
RRULE:FREQ=DAILY;COUNT=5
EXDATE;TZID=Europe/London:20261021T100000
END:VEVENT
BEGIN:VEVENT
UID:standup@example.com
RECURRENCE-ID;TZID=Europe/London:20261022T100000
SUMMARY:Standup (moved)
DTSTART;TZID=Europe/London:20261022T113000
DTEND;TZID=Europe/London:20261022T114500
END:VEVENT
BEGIN:VEVENT
UID:holiday@example.com
SUMMARY:Half term
DTSTART;VALUE=DATE:20261026
DTEND;VALUE=DATE:20261031
LOCATION:School
END:VEVENT
BEGIN:VEVENT
UID:utc@example.com
SUMMARY:UTC call
DTSTART:20261028T170000Z
DTEND:20261028T173000Z
END:VEVENT
END:VCALENDAR`;

describe("parseIcs", () => {
  const { events, skipped } = parseIcs(ICS, "#123456", "2026-10-25T00:00:00.000Z");
  const byTitle = (t: string) => events.find((e) => e.title === t);

  it("imports every VEVENT as a read-only event with deterministic ids", () => {
    expect(skipped).toBe(0);
    expect(events.map((e) => e.id).sort()).toEqual(["ics:holiday@example.com", "ics:standup@example.com", "ics:standup@example.com:2026-10-22T05:00", "ics:utc@example.com"]);
    expect(events.every((e) => e.source === "ics")).toBe(true);
    expect(parseIcs(ICS, "#123456").events.map((e) => e.id).sort()).toEqual(events.map((e) => e.id).sort());
  });

  it("converts TZID times to the local zone (10:00 London BST = 05:00 New York)", () => {
    const s = byTitle("Standup")?.schedule;
    expect(s?.kind === "timed" && wallKey(new Date(s.start))).toBe("2026-10-19T05:00");
    expect(s && durationMinutes(s)).toBe(15);
    const utc = byTitle("UTC call")?.schedule;
    expect(utc?.kind === "timed" && wallKey(new Date(utc.start))).toBe("2026-10-28T13:00");
  });

  it("keeps the rule, applies EXDATE and excludes modified instances", () => {
    const series = byTitle("Standup");
    expect(series?.recurrence?.rule).toContain("FREQ=DAILY");
    const keys = series ? occurrencesBetween(series, atLocalTime("2026-10-18", "00:00"), atLocalTime("2026-10-31", "00:00")).map((o) => o.key) : [];
    expect(keys).toEqual(["2026-10-19T05:00", "2026-10-20T05:00", "2026-10-23T05:00"]);
    expect(byTitle("Standup (moved)")).toMatchObject({ recurrence: null, recurrenceParentId: "ics:standup@example.com" });
  });

  it("maps all-day ranges with an exclusive end to spanDays", () => {
    expect(byTitle("Half term")).toMatchObject({ schedule: { kind: "day", date: "2026-10-26" }, spanDays: 5, notes: "School" });
  });

  it("survives garbage", () => {
    expect(() => parseIcs("not a calendar", "#000")).toThrow();
  });
});

const cal = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
const startsOf = (ics: string, from: string, to: string) => {
  const e = parseIcs(ics, "#000").events.find((x) => x.recurrence);
  return e ? occurrencesBetween(e, new Date(from), new Date(to)).map((o) => (o.schedule.kind === "timed" ? o.schedule.start : o.key)) : [];
};

describe("parseIcs time zones", () => {
  it("expands a UTC series in UTC, so it keeps its instant across the viewer's DST change (TIME-04)", () => {
    const ics = cal(...vevent("UID:u", "DTSTART:20261026T140000Z", "DTEND:20261026T143000Z", "RRULE:FREQ=WEEKLY;COUNT=2"));
    expect(startsOf(ics, "2026-10-25T00:00:00Z", "2026-11-10T00:00:00Z")).toEqual(["2026-10-26T14:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
  });

  it("expands a TZID series in its own zone (London stays GMT until Mar 29) (TIME-04)", () => {
    const ics = cal(...vevent("UID:l", "DTSTART;TZID=Europe/London:20260302T090000", "DTEND;TZID=Europe/London:20260302T100000", "RRULE:FREQ=WEEKLY;COUNT=5"));
    expect(startsOf(ics, "2026-03-01T00:00:00Z", "2026-04-05T00:00:00Z")).toEqual([
      "2026-03-02T09:00:00.000Z",
      "2026-03-09T09:00:00.000Z",
      "2026-03-16T09:00:00.000Z",
      "2026-03-23T09:00:00.000Z",
      "2026-03-30T08:00:00.000Z",
    ]);
  });

  it("reads an IANA TZID that has no VTIMEZONE block (TIME-06)", () => {
    const [e] = parseIcs(cal(...vevent("UID:la", "DTSTART;TZID=America/Los_Angeles:20261116T090000", "DTEND;TZID=America/Los_Angeles:20261116T100000")), "#000").events;
    expect(e.schedule).toEqual({ kind: "timed", start: "2026-11-16T17:00:00.000Z", end: "2026-11-16T18:00:00.000Z" });
  });

  it("applies a DATE exdate to a timed series (TIME-13) and adds RDATEs (TIME-17)", () => {
    const ics = cal(...vevent("UID:x", "DTSTART:20261101T140000Z", "DTEND:20261101T150000Z", "RRULE:FREQ=DAILY;COUNT=5", "EXDATE;VALUE=DATE:20261103", "RDATE:20261120T120000Z"));
    expect(startsOf(ics, "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z")).toEqual(["2026-11-01T14:00:00.000Z", "2026-11-02T14:00:00.000Z", "2026-11-04T14:00:00.000Z", "2026-11-05T14:00:00.000Z"]);
    const extra = parseIcs(ics, "#000").events.find((e) => !e.recurrence);
    expect(extra).toMatchObject({ schedule: { kind: "timed", start: "2026-11-20T12:00:00.000Z", end: "2026-11-20T13:00:00.000Z" }, recurrenceParentId: "ics:x" });
  });

  it("skips one event with a broken RRULE instead of rejecting the feed (TIME-12)", () => {
    const { events, skipped } = parseIcs(cal(...vevent("UID:bad", "DTSTART:20261101T140000Z", "RRULE:FREQ=DAILY;BYDAY=XX"), ...vevent("UID:ok", "DTSTART:20261101T140000Z")), "#000");
    expect(events.map((e) => e.id)).toEqual(["ics:ok"]);
    expect(skipped).toBe(1);
  });

  describe("east of UTC (Asia/Kolkata)", () => {
    const prev = process.env.TZ;
    beforeAll(() => void (process.env.TZ = "Asia/Kolkata"));
    afterAll(() => void (process.env.TZ = prev));

    it("keeps the occurrence that falls on a UTC UNTIL (TIME-05)", () => {
      const ics = cal(...vevent("UID:k", "DTSTART:20261101T033000Z", "DTEND:20261101T043000Z", "RRULE:FREQ=DAILY;UNTIL=20261104T033000Z"));
      expect(startsOf(ics, "2026-10-31T00:00:00Z", "2026-11-10T00:00:00Z")).toHaveLength(4);
    });
  });
});
