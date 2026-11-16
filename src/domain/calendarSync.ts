/*
 * Two-way Google Calendar and Outlook sync (FEAT-01, PLAN D345): provider events to Momentum events
 * and back, and the rules for what to send and who wins. The `calendar` Edge Function runs this
 * (bundled like `inbound`, D304) in the account's time zone `tz`, so occurrence keys match the
 * apps' (recurrence.ts: the viewer's wall clock). Provider payloads are validated here: anything that
 * isn't an event we can show maps to null. Pure; unit-tested.
 */
import { fromWall, isZone, wallIn } from "./dates";
import { isValidRule } from "./recurrence";
import { isRecord } from "./settings";
import type { CalendarEvent, CalProvider, Recurrence } from "./types";

type When = { kind: "day"; date: string } | { kind: "timed"; start: string; end: string };

/** A provider event, mapped. `series` marks an edited instance of a repeating event: the series and the occurrence it replaces. */
export type Mapped = {
  externalId: string;
  calendarId: string;
  etag: string;
  title: string;
  notes: string;
  schedule: When;
  spanDays: number;
  recurrence: Recurrence | null;
  series: { externalId: string; key: string } | null;
};
export type Change = { kind: "upsert"; event: Mapped } | { kind: "remove"; externalId: string; series: Mapped["series"] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BASIC = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/;
const str = (v: unknown) => (typeof v === "string" ? v : null);
/** `20261117T150000` for a floating date. */
const stamp = (f: Date) => f.toISOString().slice(0, 19).replace(/[-:]/g, "");
const DAY_MS = 86_400_000;
export const plusDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const iso = (d: Date) => d.toISOString();

/** Momentum's occurrence key for an instant: its wall clock in `tz` (as recurrence.ts `wallKey` in that zone). */
export const keyIn = (d: Date, tz: string) => wallIn(d, tz).toISOString().slice(0, 16);
/** The instant a timed occurrence key stands for in `tz`. */
const keyInstant = (key: string, tz: string) => fromWall(new Date(`${key}:00.000Z`), tz);

// ---------- Google (Calendar API v3) ----------

type GTime = { date: string } | { instant: Date; zone: string | null };

function gTime(v: unknown): GTime | null {
  if (!isRecord(v)) return null;
  if (typeof v.date === "string" && DATE.test(v.date)) return { date: v.date };
  const t = typeof v.dateTime === "string" ? Date.parse(v.dateTime) : NaN;
  if (Number.isNaN(t)) return null;
  return { instant: new Date(t), zone: typeof v.timeZone === "string" && isZone(v.timeZone) ? v.timeZone : null };
}

const gKey = (t: GTime, tz: string) => ("date" in t ? t.date : keyIn(t.instant, tz));

/** Occurrence keys of one EXDATE line (`;TZID=…`, `;VALUE=DATE`, or UTC values), for a series starting at `start`. */
function exdateKeys(params: string, values: string, start: GTime, tz: string): string[] {
  const tzid = /TZID=([^;:]+)/i.exec(params)?.[1];
  return values.split(",").flatMap((v) => {
    const b = BASIC.exec(v.trim());
    if (!b) return [];
    const [, y, mo, d, h, mi, s, z] = b;
    if ("date" in start) return [`${y}-${mo}-${d}`];
    const zone = start.zone ?? tz;
    let at: Date;
    if (h === undefined) {
      // A DATE exdate on a timed series excludes that day's occurrence (as ics.ts, TIME-13).
      const w = wallIn(start.instant, zone);
      at = fromWall(new Date(Date.UTC(+y, +mo - 1, +d, w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds())), zone);
    } else {
      const f = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
      at = z ? f : fromWall(f, tzid && isZone(tzid) ? tzid : zone);
    }
    return [keyIn(at, tz)];
  });
}

/** A series' `recurrence` lines as Momentum's rule: zoned like an imported .ics (TIME-04/05), so it keeps its own zone's wall clock. RDATEs are dropped. */
function googleRecurrence(lines: unknown, start: GTime, tz: string): Recurrence | null {
  if (!Array.isArray(lines)) return null;
  let rule: string | null = null;
  const exdates: string[] = [];
  for (const l of lines) {
    const m = typeof l === "string" ? /^(RRULE|EXDATE)([^:]*):(.+)$/i.exec(l.trim()) : null;
    if (!m) continue;
    if (m[1].toUpperCase() === "RRULE") rule = m[3];
    else exdates.push(...exdateKeys(m[2], m[3], start, tz));
  }
  if (!rule) return null;
  if (!("date" in start) && start.zone) {
    const z = start.zone;
    rule = rule.replace(/UNTIL=(\d{8}T\d{6})Z/i, (_, u: string) => `UNTIL=${stamp(wallIn(new Date(`${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}T${u.slice(9, 11)}:${u.slice(11, 13)}:${u.slice(13, 15)}Z`), z))}`);
    rule = `DTSTART;TZID=${z}:${stamp(wallIn(start.instant, z))}\nRRULE:${rule}`;
  }
  return isValidRule(rule) ? { rule, exdates: [...new Set(exdates)], tz: null } : null;
}

function when(start: GTime, end: GTime | null): { schedule: When; spanDays: number } | null {
  if ("date" in start) {
    const last = end && "date" in end ? end.date : plusDays(start.date, 1);
    return { schedule: { kind: "day", date: start.date }, spanDays: Math.max(1, dayDiff(start.date, last)) };
  }
  if (!end || "date" in end) return null;
  return { schedule: { kind: "timed", start: iso(start.instant), end: iso(end.instant > start.instant ? end.instant : start.instant) }, spanDays: 1 };
}

/** One item of `events.list` (singleEvents=false: series come as masters, edited instances on their own). */
export function fromGoogle(raw: unknown, calendarId: string, tz: string): Change | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const seriesId = str(raw.recurringEventId);
  const orig = gTime(raw.originalStartTime);
  const series = seriesId && orig ? { externalId: seriesId, key: gKey(orig, tz) } : null;
  if (raw.status === "cancelled") return { kind: "remove", externalId: raw.id, series };
  const start = gTime(raw.start);
  const w = start && when(start, gTime(raw.end));
  if (!start || !w) return null;
  return {
    kind: "upsert",
    event: {
      externalId: raw.id,
      calendarId,
      etag: str(raw.etag) ?? "",
      title: str(raw.summary)?.trim() || "Untitled event",
      notes: str(raw.description) ?? "",
      ...w,
      recurrence: seriesId ? null : googleRecurrence(raw.recurrence, start, tz),
      series,
    },
  };
}

/** The occurrence key an edited Google instance replaces, from its id (`<series>_20261117T150000Z` or `<series>_20261117`). */
export function googleInstanceKey(instanceId: string, seriesId: string, tz: string): string | null {
  if (!instanceId.startsWith(`${seriesId}_`)) return null;
  const b = BASIC.exec(instanceId.slice(seriesId.length + 1));
  if (!b) return null;
  const [, y, mo, d, h, mi, s] = b;
  return h === undefined ? `${y}-${mo}-${d}` : keyIn(new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), tz);
}

/** Google's `recurrence` lines for a Momentum series. Occurrences Google already has as edited instances (`instanceKeys`) aren't excluded again. */
function toGoogleRecurrence(e: CalendarEvent, zone: string, tz: string, instanceKeys: ReadonlySet<string>): string[] {
  const rec = e.recurrence;
  if (!rec) return [];
  const zoned = /^DTSTART;TZID=[^:\n]+:\S+\nRRULE:(.+)$/s.exec(rec.rule);
  // UNTIL is wall clock in the series' zone here; Google wants it in UTC for timed series.
  const body = (zoned ? zoned[1] : rec.rule).replace(/UNTIL=(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(?!Z)/i, (_, y, mo, d, h, mi, s) =>
    `UNTIL=${stamp(fromWall(new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), zone))}Z`);
  const ex = rec.exdates.filter((k) => !instanceKeys.has(k)).map((k) =>
    e.schedule.kind === "day" ? `EXDATE;VALUE=DATE:${k.slice(0, 10).replace(/-/g, "")}` : `EXDATE;TZID=${zone}:${stamp(wallIn(keyInstant(k, tz), zone))}`);
  return [`RRULE:${body}`, ...ex];
}

/** A Momentum event as a Google event body (insert or patch). An edited instance never carries `recurrence`. */
export function toGoogle(e: CalendarEvent, tz: string, instanceKeys: ReadonlySet<string> = new Set()): Record<string, unknown> {
  const ruleZone = e.recurrence && /^DTSTART;TZID=([^:\n]+):/.exec(e.recurrence.rule)?.[1];
  const zone = ruleZone && isZone(ruleZone) ? ruleZone : tz;
  const s = e.schedule;
  const time =
    s.kind === "day"
      ? { start: { date: s.date }, end: { date: plusDays(s.date, e.spanDays) } }
      : s.kind === "timed"
        ? { start: { dateTime: iso(new Date(s.start)), timeZone: zone }, end: { dateTime: iso(new Date(s.end)), timeZone: zone } }
        : {};
  return {
    summary: e.title,
    description: e.notes,
    ...time,
    ...(e.recurrenceParentId && e.link?.externalId ? {} : { recurrence: toGoogleRecurrence(e, zone, tz, instanceKeys) }),
  };
}

// ---------- Microsoft Graph (v1.0, `Prefer: outlook.timezone="UTC"`) ----------

/** Graph's `{ dateTime: "2026-11-17T15:00:00.0000000", timeZone }` as an instant (UTC, or an IANA zone), plus its wall date. */
function mTime(v: unknown): { instant: Date; date: string } | null {
  if (!isRecord(v) || typeof v.dateTime !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(v.dateTime);
  if (!m) return null;
  const f = new Date(`${m[1]}T${m[2]}Z`);
  if (Number.isNaN(f.getTime())) return null;
  const zone = typeof v.timeZone === "string" && v.timeZone !== "UTC" && isZone(v.timeZone) ? v.timeZone : null;
  return { instant: zone ? fromWall(f, zone) : f, date: m[1] };
}

/**
 * One item of a calendarView (or its delta). Graph expands series into occurrences, so every item
 * is a single event here; editing one changes that occurrence only. Removed items carry `@removed`.
 */
export function fromGraph(raw: unknown, calendarId: string): Change | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
  if (isRecord(raw["@removed"]) || raw.isCancelled === true) return { kind: "remove", externalId: raw.id, series: null };
  if (raw.type === "seriesMaster") return null;
  const s = mTime(raw.start), e = mTime(raw.end);
  if (!s || !e) return null;
  const w = raw.isAllDay === true ? when({ date: s.date }, { date: e.date }) : when({ instant: s.instant, zone: null }, { instant: e.instant, zone: null });
  if (!w) return null;
  const body = isRecord(raw.body) && raw.body.contentType === "text" ? str(raw.body.content) : null;
  return {
    kind: "upsert",
    event: {
      externalId: raw.id,
      calendarId,
      etag: str(raw["@odata.etag"]) ?? str(raw.changeKey) ?? "",
      title: str(raw.subject)?.trim() || "Untitled event",
      notes: body ?? str(raw.bodyPreview) ?? "",
      ...w,
      recurrence: null,
      series: null,
    },
  };
}

/** A Momentum event as a Graph event body. Repeating events aren't sent to Outlook (`pushAction` holds them back). */
export function toGraph(e: CalendarEvent): Record<string, unknown> {
  const s = e.schedule;
  const at = (d: string) => ({ dateTime: d, timeZone: "UTC" });
  const time =
    s.kind === "day"
      ? { isAllDay: true, start: at(`${s.date}T00:00:00`), end: at(`${plusDays(s.date, e.spanDays)}T00:00:00`) }
      : s.kind === "timed"
        ? { isAllDay: false, start: at(iso(new Date(s.start)).slice(0, 19)), end: at(iso(new Date(s.end)).slice(0, 19)) }
        : {};
  return { subject: e.title, body: { contentType: "text", content: e.notes }, ...time };
}

// ---------- rows, pushes and conflicts ----------

/**
 * The columns a provider owns, as a `calendar_events` patch (sync_rows data). Both `updated_at` and
 * `ext_synced_at` are `at`, so the event starts out with nothing to send back. `exdates` adds the
 * keys of the series' edited instances, which Google doesn't list as EXDATEs.
 */
export function toRowFields(m: Mapped, provider: CalProvider, at: string, exdates: readonly string[] = []): Record<string, unknown> {
  const s = m.schedule;
  return {
    title: m.title,
    notes: m.notes,
    start_date: s.kind === "day" ? s.date : null,
    span_days: m.spanDays,
    start_at: s.kind === "timed" ? s.start : null,
    end_at: s.kind === "timed" ? s.end : null,
    rrule: m.recurrence?.rule ?? null,
    exdates: JSON.stringify([...new Set([...(m.recurrence?.exdates ?? []), ...exdates])]),
    provider,
    external_calendar_id: m.calendarId,
    external_id: m.externalId,
    etag: m.etag,
    ext_synced_at: at,
    updated_at: at,
    deleted_at: null,
  };
}

/** The provider changed this event since Momentum last saw it (or Momentum doesn't have it). Provider wins: its version replaces the local one, edits and all. */
export const remoteChanged = (local: CalendarEvent | undefined, m: Mapped) => !local || local.link?.etag !== m.etag;

export type LinkedAccount = { provider: CalProvider; writeCalendarId: string | null; connectedAt: string };
export type PushAction = "create" | "update" | "delete";

/**
 * What a Momentum event needs on `account`'s provider. New Momentum events go to the account's
 * chosen calendar once it's connected (older ones stay Momentum-only); read-only (`ics`) events and
 * countdowns never leave. Outlook gets no repeating events: Graph series need a recurrence object
 * Momentum's RRULEs don't map onto yet.
 */
export function pushAction(e: CalendarEvent, a: LinkedAccount): PushAction | null {
  if (e.source !== "local") return null;
  const l = e.link;
  if (!l) {
    const fits = a.provider === "google" || !e.recurrence;
    return a.writeCalendarId && fits && !e.deletedAt && !e.countdown && !e.recurrenceParentId && e.createdAt >= a.connectedAt ? "create" : null;
  }
  if (l.provider !== a.provider) return null;
  if (e.deletedAt) return l.externalId ? "delete" : null;
  if (!l.externalId) return a.provider === "google" || !e.recurrence ? "create" : null;
  return e.updatedAt !== l.syncedAt ? "update" : null;
}
