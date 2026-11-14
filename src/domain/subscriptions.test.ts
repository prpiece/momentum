import { describe, expect, it } from "vitest";
import { diffSubscription, feedHost, normalizeFeedUrl, parseSubscription, subscriptionEvents, subscriptionToRow, type CalendarSubscription } from "./subscriptions";

const sub: CalendarSubscription = { id: "s1", name: "Work", url: "https://example.com/a.ics", color: "#2f9358", sortOrder: 0, createdAt: "2026-11-01T00:00:00.000Z", deletedAt: null };
const NOW = "2026-11-14T12:00:00.000Z";

const cal = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;

// Google's private address: UTC times, all-day holiday, long X- headers.
const GOOGLE = `BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
X-WR-CALNAME:Team
X-WR-TIMEZONE:UTC
BEGIN:VEVENT
DTSTART:20261116T150000Z
DTEND:20261116T160000Z
UID:abc123@google.com
SUMMARY:Planning
LOCATION:Room 4
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261126
DTEND;VALUE=DATE:20261127
UID:thanksgiving@google.com
SUMMARY:Thanksgiving
END:VEVENT
END:VCALENDAR`;

// Outlook's published calendar: Windows time zone name inside a VTIMEZONE.
const OUTLOOK = `BEGIN:VCALENDAR
PRODID:Microsoft Exchange Server 2010
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Eastern Standard Time
BEGIN:STANDARD
DTSTART:16010101T020000
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:040000008200E00074C5B7101A82E008
SUMMARY:Dentist
DTSTART;TZID=Eastern Standard Time:20261118T093000
DTEND;TZID=Eastern Standard Time:20261118T103000
END:VEVENT
END:VCALENDAR`;

// iCloud: a recurring series with an excluded date and a moved instance.
const ICLOUD = cal(
  "BEGIN:VEVENT",
  "UID:ABCD-1",
  "SUMMARY:Run",
  "DTSTART;TZID=America/New_York:20261116T070000",
  "DTEND;TZID=America/New_York:20261116T073000",
  "RRULE:FREQ=DAILY;COUNT=5",
  "EXDATE;TZID=America/New_York:20261117T070000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:ABCD-1",
  "RECURRENCE-ID;TZID=America/New_York:20261118T070000",
  "SUMMARY:Run (late)",
  "DTSTART;TZID=America/New_York:20261118T090000",
  "DTEND;TZID=America/New_York:20261118T093000",
  "END:VEVENT",
);

describe("normalizeFeedUrl / feedHost", () => {
  it("turns webcal into https and trims", () => {
    expect(normalizeFeedUrl("  webcal://p01-caldav.icloud.com/published/2/abc ")).toEqual({ ok: true, url: "https://p01-caldav.icloud.com/published/2/abc" });
    expect(normalizeFeedUrl("HTTP://a.b/c.ics")).toEqual({ ok: true, url: "HTTP://a.b/c.ics" });
  });
  it("refuses anything else", () => {
    for (const bad of ["", "file:///etc/hosts", "javascript:alert(1)", "calendar.google.com/x.ics", "https://", "https://a b/c", `https://a.b/${"x".repeat(2100)}`])
      expect(normalizeFeedUrl(bad).ok, bad).toBe(false);
  });
  it("labels an address by host only, never its secret path or credentials", () => {
    expect(feedHost("https://calendar.google.com/calendar/ical/me%40x.com/private-0123456789abcdef/basic.ics")).toBe("calendar.google.com");
    expect(feedHost("https://user:pw@Feeds.Example.com:8443/x?token=1")).toBe("feeds.example.com");
  });
});

describe("rows", () => {
  it("round-trips and drops bad rows", () => {
    const row = subscriptionToRow(sub);
    expect(parseSubscription(row)).toEqual(sub);
    expect(parseSubscription({ ...row, url: "ftp://x" })).toBeNull();
    expect(parseSubscription({ ...row, id: 3 })).toBeNull();
    expect(parseSubscription({ ...row, name: " ", color: "red" })).toMatchObject({ name: "example.com", color: null });
  });
});

describe("subscriptionEvents", () => {
  it("reads a Google private feed under the subscription's id scheme and colour", () => {
    const { events } = subscriptionEvents(sub, GOOGLE, NOW);
    expect(events.map((e) => e.id).sort()).toEqual(["sub:s1:abc123@google.com", "sub:s1:thanksgiving@google.com"]);
    expect(events.every((e) => e.source === "ics" && e.subscriptionId === "s1" && e.color === "#2f9358")).toBe(true);
    expect(events.find((e) => e.title === "Thanksgiving")?.schedule).toEqual({ kind: "day", date: "2026-11-26" });
  });
  it("reads an Outlook feed with a Windows time zone", () => {
    const { events } = subscriptionEvents(sub, OUTLOOK, NOW);
    expect(events).toHaveLength(1);
    expect(events[0].schedule.kind).toBe("timed");
  });
  it("keeps iCloud's series, exdate and moved instance linked by the new ids", () => {
    const { events } = subscriptionEvents(sub, ICLOUD, NOW);
    const series = events.find((e) => e.id === "sub:s1:ABCD-1")!;
    const moved = events.find((e) => e.recurrenceParentId)!;
    expect(series.recurrence?.exdates).toHaveLength(2);
    expect(moved.recurrenceParentId).toBe(series.id);
    expect(moved.id.startsWith("sub:s1:ABCD-1:")).toBe(true);
  });
  it("uses a fallback colour when the subscription has none", () => {
    expect(subscriptionEvents({ ...sub, color: null }, GOOGLE, NOW, "#111111").events[0].color).toBe("#111111");
  });
  it("rejects a feed that isn't a calendar (login page, error, garbage)", () => {
    expect(() => subscriptionEvents(sub, "<html><body>Sign in</body></html>")).toThrow(/isn't a calendar/);
    expect(() => subscriptionEvents(sub, "BEGIN:VCALENDAR\nBEGIN:VEVENT\nthis is not")).toThrow();
  });
  it("skips a broken event but keeps the rest", () => {
    const text = cal("BEGIN:VEVENT", "UID:x", "SUMMARY:No start", "END:VEVENT", "BEGIN:VEVENT", "UID:y", "SUMMARY:Ok", "DTSTART:20261120T100000Z", "END:VEVENT");
    const r = subscriptionEvents(sub, text, NOW);
    expect(r.events.map((e) => e.id)).toEqual(["sub:s1:y"]);
    expect(r.skipped).toBe(1);
  });
});

describe("diffSubscription", () => {
  const first = subscriptionEvents(sub, ICLOUD + "\n" + "", NOW).events;
  const stored = first;

  it("writes nothing when the feed is unchanged, even though timestamps differ", () => {
    const again = subscriptionEvents(sub, ICLOUD, "2026-11-14T12:30:00.000Z").events;
    expect(diffSubscription(stored, again, "2026-11-14T12:30:00.000Z")).toEqual({ upsert: [], remove: [] });
  });
  it("writes the first sync in full", () => {
    expect(diffSubscription([], first).upsert).toHaveLength(first.length);
  });
  it("writes only the changed event and keeps its createdAt", () => {
    const edited = subscriptionEvents(sub, ICLOUD.replace("SUMMARY:Run (late)", "SUMMARY:Run (later)"), "2026-11-15T00:00:00.000Z").events;
    const { upsert, remove } = diffSubscription(stored, edited);
    expect(remove).toEqual([]);
    expect(upsert.map((e) => e.title)).toEqual(["Run (later)"]);
    expect(upsert[0].createdAt).toBe(NOW);
  });
  it("removes events that left the feed, and restores one that returns", () => {
    const gone = subscriptionEvents(sub, GOOGLE, NOW).events;
    const all = [...stored, ...gone];
    const { remove } = diffSubscription(all, gone, "2026-11-16T00:00:00.000Z");
    expect(remove.map((e) => e.id).sort()).toEqual(stored.map((e) => e.id).sort());
    expect(remove.every((e) => e.deletedAt === "2026-11-16T00:00:00.000Z")).toBe(true);
    // Already removed events aren't removed again; coming back clears deletedAt.
    expect(diffSubscription(remove, gone).remove).toEqual([]);
    expect(diffSubscription(remove, first).upsert.map((e) => e.deletedAt)).toEqual(first.map(() => null));
  });
  it("rewrites events when the subscription is recoloured", () => {
    const recoloured = subscriptionEvents({ ...sub, color: "#d6457a" }, ICLOUD, NOW).events;
    expect(diffSubscription(stored, recoloured).upsert).toHaveLength(stored.length);
  });
});
