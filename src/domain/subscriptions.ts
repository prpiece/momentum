/*
 * Calendar subscriptions (v1.3, PLAN D-subscriptions): a read-only calendar kept in step with an
 * .ics address. Pure: fetching happens in Rust (net.rs), writing in stores/subscriptions.ts.
 * Event ids are `sub:<subscriptionId>:<uid>[:<recurrence key>]`, so every device derives the same
 * ids and a refresh updates in place; `importIcs` keeps its own `ics:` ids.
 */
import { parseIcs } from "./ics";
import type { CalendarEvent } from "./types";

export type CalendarSubscription = {
  id: string;
  name: string;
  url: string;
  color: string | null;
  sortOrder: number;
  createdAt: string;
  deletedAt: string | null;
};

export const MAX_URL_LENGTH = 2048;
export const MAX_NAME_LENGTH = 80;

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/** What the user pasted, as the address that gets stored: `webcal://` becomes `https://`. */
export function normalizeFeedUrl(input: string): UrlCheck {
  const raw = input.trim().replace(/^webcal:\/\//i, "https://");
  if (!/^https?:\/\/[^\s/?#]+([/?#]\S*)?$/i.test(raw)) return { ok: false, error: "That doesn't look like a calendar address. It should start with https:// or webcal://." };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: "That address is too long." };
  return { ok: true, url: raw };
}

/** A safe label for an address: the host only. Paths and query strings (private feeds carry a secret token there) and credentials stay out of the UI. */
export function feedHost(url: string): string {
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase() : "calendar";
}

// ---------- rows (the DB trust boundary) ----------

type Row = Record<string, unknown>;

export function parseSubscription(r: Row): CalendarSubscription | null {
  if (typeof r.id !== "string" || typeof r.url !== "string") return null;
  const check = normalizeFeedUrl(r.url);
  if (!check.ok) return null;
  const at = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    id: r.id,
    name: typeof r.name === "string" && r.name.trim() ? r.name.slice(0, MAX_NAME_LENGTH) : feedHost(check.url),
    url: check.url,
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : null,
    sortOrder: typeof r.sort_order === "number" && Number.isFinite(r.sort_order) ? r.sort_order : 0,
    createdAt: at(r.created_at) ?? new Date().toISOString(),
    deletedAt: at(r.deleted_at),
  };
}

export const subscriptionToRow = (s: CalendarSubscription): Row => ({
  id: s.id,
  name: s.name,
  url: s.url,
  color: s.color,
  sort_order: s.sortOrder,
  created_at: s.createdAt,
  deleted_at: s.deletedAt,
});

// ---------- feed -> events ----------

export const subscriptionEventId = (subId: string, icsId: string) => `sub:${subId}:${icsId.replace(/^ics:/, "")}`;

/** The feed's events as this subscription's. Throws if the text isn't an iCalendar (a login page, an error). */
export function subscriptionEvents(sub: CalendarSubscription, text: string, now = new Date().toISOString(), fallbackColor = "#2563d9") {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That address isn't a calendar feed.");
  let parsed;
  try {
    parsed = parseIcs(text, sub.color ?? fallbackColor, now);
  } catch {
    throw new Error("The calendar couldn't be read.");
  }
  const events = parsed.events.map(
    (e): CalendarEvent => ({
      ...e,
      id: subscriptionEventId(sub.id, e.id),
      recurrenceParentId: e.recurrenceParentId && subscriptionEventId(sub.id, e.recurrenceParentId),
      subscriptionId: sub.id,
    }),
  );
  return { events, skipped: parsed.skipped };
}

/** Everything that matters about an event except its timestamps. */
const content = (e: CalendarEvent) =>
  JSON.stringify([e.title, e.notes, e.schedule, e.spanDays, e.color, e.recurrence && [e.recurrence.rule, [...e.recurrence.exdates].sort()], e.recurrenceParentId, e.source, e.subscriptionId, e.deletedAt]);

/**
 * What a refresh must write: events that are new or changed (an event that came back after being
 * removed counts), and events gone from the feed (soft-deleted, like any event). An unchanged
 * event produces no write, so refreshing every 30 minutes adds nothing to the sync outbox.
 * `existing` is every stored event of this subscription.
 */
export function diffSubscription(existing: CalendarEvent[], incoming: CalendarEvent[], now = new Date().toISOString()) {
  const have = new Map(existing.map((e) => [e.id, e]));
  const seen = new Set(incoming.map((e) => e.id));
  const upsert = incoming.flatMap((e) => {
    const old = have.get(e.id);
    if (!old) return [e];
    return content(old) === content(e) ? [] : [{ ...e, createdAt: old.createdAt }];
  });
  const remove = existing.filter((e) => !e.deletedAt && !seen.has(e.id)).map((e) => ({ ...e, deletedAt: now, updatedAt: now }));
  return { upsert, remove };
}
