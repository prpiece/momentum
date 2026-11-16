import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: plain .mjs script, no types
import { bundle, outOf } from "../../scripts/bundle-inbound.mjs";
import { parseEvent } from "../db/rows";
import { fromGoogle, fromGraph, googleInstanceKey, keyIn, plusDays, pushAction, remoteChanged, toGoogle, toGraph, toRowFields, type Mapped } from "./calendarSync";
import { occurrencesBetween } from "./recurrence";
import type { CalendarEvent } from "./types";

// Tests run in TZ=America/New_York; the account zone `tz` is passed explicitly.
const NY = "America/New_York";
const AT = "2026-11-17T12:00:00.000Z";

const upsert = (c: ReturnType<typeof fromGoogle>): Mapped => {
  if (c?.kind !== "upsert") throw new Error(`not an upsert: ${JSON.stringify(c)}`);
  return c.event;
};

/** A mapped event as the apps would load it from the row the function writes. */
const asEvent = (m: Mapped, extra: Record<string, unknown> = {}, provider: "google" | "microsoft" = "google"): CalendarEvent => {
  const e = parseEvent({ id: "e1", created_at: AT, source: "local", ...toRowFields(m, provider, AT), ...extra });
  if (!e) throw new Error("unparseable");
  return e;
};

describe("Google events in", () => {
  it("maps a timed event to UTC instants", () => {
    const m = upsert(fromGoogle({ id: "a", etag: '"1"', summary: " Standup ", start: { dateTime: "2026-11-18T09:30:00-05:00" }, end: { dateTime: "2026-11-18T10:00:00-05:00" } }, "cal", NY));
    expect(m).toMatchObject({ externalId: "a", etag: '"1"', title: "Standup", schedule: { kind: "timed", start: "2026-11-18T14:30:00.000Z", end: "2026-11-18T15:00:00.000Z" }, spanDays: 1, recurrence: null, series: null });
  });

  it("maps an all-day event to local dates, end exclusive", () => {
    const m = upsert(fromGoogle({ id: "b", start: { date: "2026-11-20" }, end: { date: "2026-11-23" } }, "cal", NY));
    expect(m.schedule).toEqual({ kind: "day", date: "2026-11-20" });
    expect(m.spanDays).toBe(3);
    expect(m.title).toBe("Untitled event");
  });

  it("keeps a zoned series in its own zone, UNTIL and EXDATEs included", () => {
    const m = upsert(fromGoogle({
      id: "s", etag: '"2"', summary: "London sync",
      start: { dateTime: "2026-11-02T09:00:00Z", timeZone: "Europe/London" }, end: { dateTime: "2026-11-02T10:00:00Z", timeZone: "Europe/London" },
      recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20261130T090000Z", "EXDATE;TZID=Europe/London:20261109T090000", "EXDATE:20261116T090000Z"],
    }, "cal", NY));
    expect(m.recurrence?.rule).toBe("DTSTART;TZID=Europe/London:20261102T090000\nRRULE:FREQ=WEEKLY;UNTIL=20261130T090000");
    // 09:00 London is 04:00 in New York.
    expect(m.recurrence?.exdates).toEqual(["2026-11-09T04:00", "2026-11-16T04:00"]);
    const occ = occurrencesBetween(asEvent(m), new Date("2026-11-01"), new Date("2026-12-31"));
    expect(occ.map((o) => o.key)).toEqual(["2026-11-02T04:00", "2026-11-23T04:00", "2026-11-30T04:00"]);
  });

  it("maps an all-day series and its DATE exdates", () => {
    const m = upsert(fromGoogle({ id: "d", start: { date: "2026-11-01" }, end: { date: "2026-11-02" }, recurrence: ["RRULE:FREQ=DAILY;COUNT=3", "EXDATE;VALUE=DATE:20261102"] }, "cal", NY));
    expect(m.recurrence).toEqual({ rule: "FREQ=DAILY;COUNT=3", exdates: ["2026-11-02"], tz: null });
  });

  it("drops a rule it can't expand instead of the event", () => {
    const m = upsert(fromGoogle({ id: "x", start: { date: "2026-11-01" }, end: { date: "2026-11-02" }, recurrence: ["RRULE:FREQ=SECONDLY"] }, "cal", NY));
    expect(m.recurrence).toBeNull();
  });

  it("ties an edited instance to its series and the occurrence it replaces", () => {
    const m = upsert(fromGoogle({
      id: "s_20261109T090000Z", recurringEventId: "s", originalStartTime: { dateTime: "2026-11-09T09:00:00Z", timeZone: "Europe/London" },
      start: { dateTime: "2026-11-09T11:00:00Z" }, end: { dateTime: "2026-11-09T12:00:00Z" }, recurrence: ["RRULE:FREQ=DAILY"],
    }, "cal", NY));
    expect(m.series).toEqual({ externalId: "s", key: "2026-11-09T04:00" });
    expect(m.recurrence).toBeNull();
  });

  it("turns a cancelled instance into a removal that names the occurrence", () => {
    expect(fromGoogle({ id: "s_20261109", status: "cancelled", recurringEventId: "s", originalStartTime: { date: "2026-11-09" } }, "cal", NY))
      .toEqual({ kind: "remove", externalId: "s_20261109", series: { externalId: "s", key: "2026-11-09" } });
    expect(fromGoogle({ id: "gone", status: "cancelled" }, "cal", NY)).toEqual({ kind: "remove", externalId: "gone", series: null });
  });

  it("refuses payloads that aren't events", () => {
    for (const bad of [null, 1, "x", {}, { id: "" }, { id: "a", start: { dateTime: "nope" }, end: {} }, { id: "a", start: { dateTime: "2026-11-18T09:30:00Z" }, end: { date: "2026-11-19" } }])
      expect(fromGoogle(bad, "cal", NY)).toBeNull();
  });

  it("reads the replaced occurrence from an instance id, in any account zone", () => {
    expect(googleInstanceKey("abc_20261109T090000Z", "abc", NY)).toBe("2026-11-09T04:00");
    expect(googleInstanceKey("abc_20261109T090000Z", "abc", "Asia/Tokyo")).toBe("2026-11-09T18:00");
    expect(googleInstanceKey("abc_20261109", "abc", NY)).toBe("2026-11-09");
    expect(googleInstanceKey("other_20261109", "abc", NY)).toBeNull();
    expect(googleInstanceKey("abc_garbage", "abc", NY)).toBeNull();
  });
});

describe("Google events out", () => {
  it("sends a zoned series back with UTC UNTIL and zoned EXDATEs, minus edited instances", () => {
    const m = upsert(fromGoogle({
      id: "s", start: { dateTime: "2026-11-02T09:00:00Z", timeZone: "Europe/London" }, end: { dateTime: "2026-11-02T10:00:00Z", timeZone: "Europe/London" },
      recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20261130T090000Z", "EXDATE;TZID=Europe/London:20261109T090000"],
    }, "cal", NY));
    const e = asEvent(m, {}, "google");
    const withInstance = { ...e, recurrence: { rule: e.recurrence!.rule, exdates: [...e.recurrence!.exdates, "2026-11-16T04:00"], tz: null } };
    const body = toGoogle(withInstance, NY, new Set(["2026-11-16T04:00"]));
    expect(body).toMatchObject({
      start: { dateTime: "2026-11-02T09:00:00.000Z", timeZone: "Europe/London" },
      recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20261130T090000Z", "EXDATE;TZID=Europe/London:20261109T090000"],
    });
  });

  it("sends a floating Momentum series in the account's zone", () => {
    const e = asEvent(upsert(fromGoogle({ id: "f", start: { dateTime: "2026-11-02T14:00:00Z" }, end: { dateTime: "2026-11-02T15:00:00Z" } }, "cal", NY)));
    const series = { ...e, recurrence: { rule: "FREQ=DAILY;UNTIL=20261110T090000", exdates: ["2026-11-04T09:00"], tz: null } };
    expect(toGoogle(series, NY)).toMatchObject({
      start: { timeZone: NY },
      recurrence: ["RRULE:FREQ=DAILY;UNTIL=20261110T140000Z", "EXDATE;TZID=America/New_York:20261104T090000"],
    });
  });

  it("sends all-day events with an exclusive end, and edited instances without recurrence", () => {
    const e = asEvent(upsert(fromGoogle({ id: "b", start: { date: "2026-11-20" }, end: { date: "2026-11-23" } }, "cal", NY)));
    expect(toGoogle(e, NY)).toEqual({ summary: "Untitled event", description: "", start: { date: "2026-11-20" }, end: { date: "2026-11-23" }, recurrence: [] });
    expect(toGoogle({ ...e, recurrenceParentId: "series" }, NY)).not.toHaveProperty("recurrence");
  });
});

describe("Outlook events", () => {
  it("maps timed (UTC or IANA zone), all-day, removed and cancelled items", () => {
    const t = fromGraph({ id: "m1", "@odata.etag": 'W/"x"', subject: "Review", body: { contentType: "text", content: "Agenda" }, start: { dateTime: "2026-11-18T14:30:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-18T15:00:00.0000000", timeZone: "UTC" } }, "cal");
    expect(t).toMatchObject({ kind: "upsert", event: { etag: 'W/"x"', notes: "Agenda", schedule: { kind: "timed", start: "2026-11-18T14:30:00.000Z", end: "2026-11-18T15:00:00.000Z" } } });
    const z = fromGraph({ id: "m2", start: { dateTime: "2026-11-18T09:30:00", timeZone: "Asia/Tokyo" }, end: { dateTime: "2026-11-18T10:00:00", timeZone: "Asia/Tokyo" } }, "cal");
    expect(z).toMatchObject({ event: { schedule: { start: "2026-11-18T00:30:00.000Z" } } });
    const d = fromGraph({ id: "m3", isAllDay: true, bodyPreview: "html body", body: { contentType: "html", content: "<p>x</p>" }, start: { dateTime: "2026-11-20T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-22T00:00:00.0000000", timeZone: "UTC" } }, "cal");
    expect(d).toMatchObject({ event: { schedule: { kind: "day", date: "2026-11-20" }, spanDays: 2, notes: "html body" } });
    expect(fromGraph({ id: "m4", "@removed": { reason: "deleted" } }, "cal")).toEqual({ kind: "remove", externalId: "m4", series: null });
    expect(fromGraph({ id: "m5", isCancelled: true, start: {}, end: {} }, "cal")).toMatchObject({ kind: "remove" });
    expect(fromGraph({ id: "m6", type: "seriesMaster" }, "cal")).toBeNull();
    expect(fromGraph({ id: "m7", start: { dateTime: "bad" }, end: {} }, "cal")).toBeNull();
  });

  it("sends Momentum events in UTC", () => {
    const e = asEvent(upsert(fromGoogle({ id: "a", start: { dateTime: "2026-11-18T09:30:00-05:00" }, end: { dateTime: "2026-11-18T10:00:00-05:00" } }, "cal", NY)), {}, "microsoft");
    expect(toGraph(e)).toEqual({ subject: "Untitled event", body: { contentType: "text", content: "" }, isAllDay: false, start: { dateTime: "2026-11-18T14:30:00", timeZone: "UTC" }, end: { dateTime: "2026-11-18T15:00:00", timeZone: "UTC" } });
    const day = { ...e, schedule: { kind: "day" as const, date: "2026-12-31" }, spanDays: 1 };
    expect(toGraph(day)).toMatchObject({ isAllDay: true, start: { dateTime: "2026-12-31T00:00:00" }, end: { dateTime: "2027-01-01T00:00:00" } });
  });
});

describe("rows, pushes and conflicts", () => {
  const m = upsert(fromGoogle({ id: "a", etag: '"1"', start: { date: "2026-11-20" }, end: { date: "2026-11-21" } }, "cal", NY));
  const linked = asEvent(m);
  const google = { provider: "google" as const, writeCalendarId: "cal", connectedAt: "2026-11-01T00:00:00.000Z" };

  it("loads a written row as a linked event with nothing to send", () => {
    expect(linked.link).toEqual({ provider: "google", calendarId: "cal", externalId: "a", etag: '"1"', syncedAt: AT });
    expect(pushAction(linked, google)).toBeNull();
    expect(JSON.parse(String(toRowFields(m, "google", AT, ["2026-11-25", "2026-11-25"]).exdates))).toEqual(["2026-11-25"]);
  });

  it("sends edits, deletes and creates", () => {
    expect(pushAction({ ...linked, updatedAt: "2026-11-17T13:00:00.000Z" }, google)).toBe("update");
    expect(pushAction({ ...linked, deletedAt: AT }, google)).toBe("delete");
    expect(pushAction({ ...linked, deletedAt: AT, link: { ...linked.link!, externalId: null } }, google)).toBeNull();
    expect(pushAction({ ...linked, link: { ...linked.link!, externalId: null } }, google)).toBe("create");
    expect(pushAction({ ...linked, updatedAt: "x" }, { ...google, provider: "microsoft" })).toBeNull();
  });

  it("sends new Momentum events only to a chosen calendar, after connecting", () => {
    const local: CalendarEvent = { ...linked, link: undefined, createdAt: "2026-11-10T00:00:00.000Z" };
    expect(pushAction(local, google)).toBe("create");
    expect(pushAction(local, { ...google, writeCalendarId: null })).toBeNull();
    expect(pushAction({ ...local, createdAt: "2026-10-01T00:00:00.000Z" }, google)).toBeNull();
    expect(pushAction({ ...local, countdown: "until" }, google)).toBeNull();
    expect(pushAction({ ...local, source: "ics" }, google)).toBeNull();
    expect(pushAction({ ...local, recurrenceParentId: "p" }, google)).toBeNull();
    const series = { ...local, recurrence: { rule: "FREQ=DAILY", exdates: [], tz: null } };
    expect(pushAction(series, google)).toBe("create");
    expect(pushAction(series, { ...google, provider: "microsoft" })).toBeNull();
  });

  it("lets the provider win only when it changed", () => {
    expect(remoteChanged(undefined, m)).toBe(true);
    expect(remoteChanged({ ...linked, updatedAt: "2026-11-18T00:00:00.000Z" }, m)).toBe(false);
    expect(remoteChanged(linked, { ...m, etag: '"2"' })).toBe(true);
  });

  it("keys instants in the account's zone and adds days without DST drift", () => {
    expect(keyIn(new Date("2026-11-01T05:30:00Z"), NY)).toBe("2026-11-01T01:30");
    expect(keyIn(new Date("2026-11-01T06:30:00Z"), NY)).toBe("2026-11-01T01:30"); // the repeated hour
    expect(keyIn(new Date("2026-11-01T05:30:00Z"), "Australia/Sydney")).toBe("2026-11-01T16:30");
    expect(plusDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(plusDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("the calendar function's bundle (D304)", () => {
  it("is current and contains only pure code (run scripts/bundle-inbound.mjs)", async () => {
    const { code, inputs } = await bundle("calendar");
    expect(readFileSync(outOf("calendar"), "utf8")).toBe(code);
    const allowed = /(src\/domain\/[a-zA-Z]+\.ts|src\/db\/rows\.ts|supabase\/functions\/calendar\/core\.ts|node_modules\/(date-fns|rrule|tslib)\/)/;
    expect((inputs as string[]).filter((i) => !allowed.test(i))).toEqual([]);
  });
});
