/*
 * The `calendar` Edge Function (FEAT-01, PLAN D345): Google Calendar and Outlook, both ways.
 *
 *   POST /connect/{google|microsoft}  (user token) → { url }: a 2-minute signed link to the GET below
 *   GET  /connect/{provider}?t=…      sets the state cookie and sends the browser to the consent screen (PKCE)
 *   GET  /callback/{provider}         checks the signed state and cookie, stores the grant, starts a first sync
 *   GET  /list                        (user token) the accounts, their calendars refreshed from the provider
 *   POST /calendars/{provider}        (user token) { sync: string[], write: string | null }
 *   POST /sync                        (user token) pull then push the user's accounts
 *   POST /disconnect/{provider}       (user token) { keep?: boolean }: revoke, forget, remove (or keep) its events
 *   POST /cron                        pg_cron (`x-cron-secret`): the accounts synced longest ago
 *
 * Events land in the user's `calendar_events` records through `calendar_write` and reach the apps by
 * normal sync. Tokens are never logged: errors log the provider, the step and the HTTP status only.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as core from "./core.bundle.js";
import type { CalendarEvent, CalProvider, Change, LinkedAccount, Mapped } from "./core.bundle.js";

export type Env = Partial<Record<
  | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "MS_CLIENT_ID" | "MS_CLIENT_SECRET"
  | "MS_TENANT" | "CALENDAR_TOKEN_KEY" | "CALENDAR_STATE_SECRET" | "CALENDAR_CRON_SECRET" | "CALENDAR_PUBLIC_URL",
  string>>;
export type Opts = { fetch?: typeof fetch; waitUntil?: (p: Promise<unknown>) => void; now?: () => number };

const enc = new TextEncoder();
const dec = new TextDecoder();
const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
const page = (text: string, status = 200) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const isProvider = (p: unknown): p is CalProvider => p === "google" || p === "microsoft";
const NAME: Record<CalProvider, string> = { google: "Google Calendar", microsoft: "Outlook" };

// ---------- secrets: signed state, PKCE, sealed tokens ----------

/** Compares secrets without leaking where they differ. */
export function same(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

async function hmac(secret: string, msg: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, enc.encode(msg));
}

/** `<expiry>.<parts…>.<hmac>`; parts never contain dots. */
export async function signToken(secret: string, ttlMs: number, now: number, parts: string[]): Promise<string> {
  const body = [String(now + ttlMs), ...parts].join(".");
  return `${body}.${toHex(await hmac(secret, body))}`;
}

/** The parts of a token we signed that hasn't expired, or null. */
export async function readToken(secret: string, token: string | null, now: number): Promise<string[] | null> {
  const all = (token ?? "").split(".");
  if (!secret || all.length < 3) return null;
  const sig = all.pop()!;
  if (!same(sig, toHex(await hmac(secret, all.join("."))))) return null;
  return Number(all[0]) > now ? all.slice(1) : null;
}

/** The PKCE verifier for a state nonce: derived, so nothing is stored between the redirect and the callback. */
export const pkceVerifier = async (secret: string, nonce: string) => b64url(new Uint8Array(await hmac(secret, `pkce.${nonce}`)));
const pkceChallenge = async (verifier: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));

async function aesKey(keyB64: string | undefined): Promise<CryptoKey> {
  const raw = keyB64 ? unb64(keyB64) : new Uint8Array();
  if (raw.length !== 32) throw new Error("CALENDAR_TOKEN_KEY must be 32 random bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-GCM with the account id as associated data, so a sealed token only opens for its own account. */
export async function seal(keyB64: string | undefined, plain: string, account: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(account) }, await aesKey(keyB64), enc.encode(plain));
  return b64(new Uint8Array([...iv, ...new Uint8Array(ct)]));
}

export async function unseal(keyB64: string | undefined, sealed: string, account: string): Promise<string> {
  const all = unb64(sealed);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12), additionalData: enc.encode(account) }, await aesKey(keyB64), all.slice(12));
  return dec.decode(pt);
}

// ---------- providers ----------

type Creds = { id: string; secret: string; auth: string; token: string; scope: string; extra: Record<string, string> };

function creds(env: Env, p: CalProvider): Creds | null {
  if (p === "google") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    return {
      id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET,
      auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/calendar",
      // offline + consent: Google only hands out a refresh token on a consent screen.
      extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    };
  }
  if (!env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) return null;
  const tenant = /^[\w.-]+$/.test(env.MS_TENANT ?? "") ? env.MS_TENANT! : "common";
  return {
    id: env.MS_CLIENT_ID, secret: env.MS_CLIENT_SECRET,
    auth: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`, token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scope: "offline_access Calendars.ReadWrite User.Read",
    extra: { response_mode: "query", prompt: "select_account" },
  };
}

/** The function's own public address: the only redirect URI either provider is given. */
const base = (env: Env) => (env.CALENDAR_PUBLIC_URL ?? `${env.SUPABASE_URL}/functions/v1/calendar`).replace(/\/$/, "");
const redirectUri = (env: Env, p: CalProvider) => `${base(env)}/callback/${p}`;

class Reconnect extends Error {}
class HttpError extends Error {
  constructor(public step: string, public status: number) {
    super(`${step}: HTTP ${status}`);
  }
}

type Tokens = { access: string; refresh: string | null };

async function tokenCall(f: typeof fetch, c: Creds, form: Record<string, string>, step: string): Promise<Tokens> {
  const r = await f(c.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...form }) });
  const out = await r.json().catch(() => null);
  if (!r.ok || typeof out?.access_token !== "string") {
    if (out?.error === "invalid_grant") throw new Reconnect(step);
    throw new HttpError(step, r.status);
  }
  return { access: out.access_token, refresh: typeof out.refresh_token === "string" ? out.refresh_token : null };
}

const GOOGLE = "https://www.googleapis.com/calendar/v3";
const GRAPH = "https://graph.microsoft.com/v1.0";
const GRAPH_PREFER = 'outlook.timezone="UTC", outlook.body-content-type="text", odata.maxpagesize=100';

async function api(f: typeof fetch, access: string, url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  return f(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${access}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(url.startsWith(GRAPH) ? { prefer: GRAPH_PREFER } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function ok(r: Response, step: string): Promise<Record<string, unknown>> {
  if (!r.ok) throw new HttpError(step, r.status);
  const j = await r.json().catch(() => null);
  if (typeof j !== "object" || j === null) throw new HttpError(step, r.status);
  return j as Record<string, unknown>;
}

export type Cal = { id: string; name: string; color: string | null; primary: boolean; canEdit: boolean; sync: boolean };
const HEX = /^#[0-9a-f]{6}$/i;

/** The account's calendars from the provider, with the sync choices kept (a new account syncs its main calendar). */
async function listCalendars(f: typeof fetch, p: CalProvider, access: string, kept: Cal[]): Promise<Cal[]> {
  const out: Omit<Cal, "sync">[] = [];
  let url: string | null = p === "google" ? `${GOOGLE}/users/me/calendarList?maxResults=250` : `${GRAPH}/me/calendars?$top=100`;
  while (url) {
    const j = await ok(await api(f, access, url), "calendars");
    for (const c of Array.isArray(j.items) ? j.items : Array.isArray(j.value) ? j.value : []) {
      if (typeof c?.id !== "string") continue;
      const name = String(c.summaryOverride ?? c.summary ?? c.name ?? "Calendar").slice(0, 120);
      const color = p === "google" ? c.backgroundColor : c.hexColor;
      out.push({
        id: c.id, name, color: typeof color === "string" && HEX.test(color) ? color.toLowerCase() : null,
        primary: p === "google" ? c.primary === true : c.isDefaultCalendar === true,
        canEdit: p === "google" ? c.accessRole === "owner" || c.accessRole === "writer" : c.canEdit === true,
      });
    }
    url = p === "google" ? (typeof j.nextPageToken === "string" ? `${GOOGLE}/users/me/calendarList?maxResults=250&pageToken=${encodeURIComponent(j.nextPageToken)}` : null)
      : typeof j["@odata.nextLink"] === "string" && j["@odata.nextLink"].startsWith(GRAPH) ? j["@odata.nextLink"] : null;
  }
  const was = new Map(kept.map((c) => [c.id, c.sync]));
  return out.map((c) => ({ ...c, sync: was.get(c.id) ?? (kept.length === 0 && c.primary) }));
}

async function accountEmail(f: typeof fetch, p: CalProvider, access: string, cals: Cal[]): Promise<string | null> {
  if (p === "google") return cals.find((c) => c.primary)?.id ?? null; // the primary calendar's id is the address
  const me = await ok(await api(f, access, `${GRAPH}/me?$select=mail,userPrincipalName`), "profile");
  const m = me.mail ?? me.userPrincipalName;
  return typeof m === "string" ? m : null;
}

// ---------- pulling ----------

const WINDOW_BACK_MS = 90 * 86_400_000;
const WINDOW_AHEAD_MS = 400 * 86_400_000;
/** A Graph delta link stops at the window it was made with: start over monthly so the window moves along. */
const DELTA_MAX_AGE_MS = 30 * 86_400_000;

type Cursor = { c: string; at: string };
type Pulled = { changes: Change[]; cursor: Cursor | null; full: boolean; from: string } | "reset";

async function pull(f: typeof fetch, p: CalProvider, access: string, cal: Cal, cursor: Cursor | undefined, tz: string, now: number): Promise<Pulled> {
  const from = new Date(now - WINDOW_BACK_MS).toISOString();
  const to = new Date(now + WINDOW_AHEAD_MS).toISOString();
  const changes: Change[] = [];
  if (p === "google") {
    const q = new URLSearchParams({ singleEvents: "false", showDeleted: "true", maxResults: "250", ...(cursor ? { syncToken: cursor.c } : { timeMin: from }) });
    for (let pageToken: string | null = null; ;) {
      if (pageToken) q.set("pageToken", pageToken);
      const r = await api(f, access, `${GOOGLE}/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
      if (r.status === 410) return "reset"; // the sync token expired: full sync
      const j = await ok(r, "events");
      for (const item of Array.isArray(j.items) ? j.items : []) {
        const c = core.fromGoogle(item, cal.id, tz);
        if (c) changes.push(c);
      }
      if (typeof j.nextPageToken === "string") pageToken = j.nextPageToken;
      else return { changes, cursor: typeof j.nextSyncToken === "string" ? { c: j.nextSyncToken, at: cursor?.at ?? new Date(now).toISOString() } : null, full: !cursor, from };
    }
  }
  // Graph keeps deltas for the default calendar only (v1.0); other calendars are read whole over the window.
  const fresh = cursor && now - Date.parse(cursor.at) < DELTA_MAX_AGE_MS ? cursor : undefined;
  const range = `startDateTime=${from}&endDateTime=${to}`;
  let url: string | null = !cal.primary ? `${GRAPH}/me/calendars/${encodeURIComponent(cal.id)}/calendarView?${range}&$top=100`
    : fresh?.c ?? `${GRAPH}/me/calendarView/delta?${range}`;
  let next: Cursor | null = null;
  while (url) {
    const r = await api(f, access, url);
    if (cal.primary && fresh && (r.status === 410 || r.status === 400 || r.status === 404)) return "reset"; // syncStateNotFound and friends
    const j = await ok(r, "events");
    for (const item of Array.isArray(j.value) ? j.value : []) {
      const c = core.fromGraph(item, cal.id);
      if (c) changes.push(c);
    }
    const link = (k: string) => (typeof j[k] === "string" && (j[k] as string).startsWith(GRAPH) ? (j[k] as string) : null);
    url = link("@odata.nextLink");
    const delta = link("@odata.deltaLink");
    if (delta) next = { c: delta, at: fresh?.at ?? new Date(now).toISOString() };
  }
  return { changes, cursor: next, full: !fresh, from };
}

// ---------- one account's sync ----------

export type Account = {
  id: string; user_id: string; provider: CalProvider; email: string | null; calendars: Cal[]; write_calendar_id: string | null;
  cursors: Record<string, Cursor>; connected_at: string; last_sync: string | null; error: string | null;
};
export type Ctx = { db: SupabaseClient; env: Env; f: typeof fetch; now: number };

async function accessFor(c: Ctx, a: Account): Promise<string> {
  const cr = creds(c.env, a.provider);
  if (!cr) throw new Error(`${a.provider} isn't set up`);
  const { data } = await c.db.from("calendar_tokens").select("refresh_token").eq("account_id", a.id).maybeSingle();
  if (!data) throw new Reconnect("token");
  const refresh = await unseal(c.env.CALENDAR_TOKEN_KEY, data.refresh_token, a.id);
  const t = await tokenCall(c.f, cr, { grant_type: "refresh_token", refresh_token: refresh, ...(a.provider === "microsoft" ? { scope: cr.scope } : {}) }, "refresh");
  // Microsoft rotates refresh tokens; keep the newest.
  if (t.refresh && t.refresh !== refresh) await c.db.from("calendar_tokens").update({ refresh_token: await seal(c.env.CALENDAR_TOKEN_KEY, t.refresh, a.id) }).eq("account_id", a.id);
  return t.access;
}

async function zoneOf(db: SupabaseClient, user: string): Promise<string> {
  const { data } = await db.from("profiles").select("time_zone").eq("id", user).maybeSingle();
  const tz = data?.time_zone;
  return typeof tz === "string" && core.isZone(tz) ? tz : "UTC";
}

/** The user's events as the apps would load them, plus a writer that merges into them and queues the write. */
async function eventsOf(db: SupabaseClient, user: string) {
  const events = new Map<string, CalendarEvent>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("sync_rows").select("id, data").eq("owner_id", user).eq("tbl", "calendar_events").order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of data) {
      const e = core.parseEvent({ ...(r.data as Record<string, unknown>), id: r.id });
      if (e) events.set(e.id, e);
    }
    if (data.length < 1000) break;
  }
  const byExt = new Map<string, string>();
  const index = (e: CalendarEvent) => e.link?.externalId && byExt.set(`${e.link.calendarId}|${e.link.externalId}`, e.id);
  events.forEach(index);
  const writes = new Map<string, Record<string, unknown>>();
  const put = (id: string, fields: Record<string, unknown>) => {
    writes.set(id, { ...writes.get(id), ...fields });
    const cur = events.get(id);
    const e = core.parseEvent({ ...(cur ? core.eventToRow(cur) : {}), ...fields, id });
    if (e) {
      events.set(id, e);
      index(e);
    }
  };
  const flush = async () => {
    const rows = [...writes].map(([id, fields]) => ({ id, fields }));
    writes.clear();
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.rpc("calendar_write", { p_account: user, p_rows: rows.slice(i, i + 200) });
      if (error) throw error;
    }
  };
  return { events, byExt, put, flush };
}
type Store = Awaited<ReturnType<typeof eventsOf>>;

/** Deterministic ids for provider events, so a retried run never duplicates one. */
async function stableId(p: CalProvider, cal: string, ext: string): Promise<string> {
  return `cal-${p === "google" ? "g" : "m"}-${toHex(await crypto.subtle.digest("SHA-256", enc.encode(`${cal}|${ext}`))).slice(0, 32)}`;
}

/** A removed event goes away on every device (`_purged`, D333) and forgets its provider id. */
const gone = (at: string) => ({ deleted_at: at, _purged: 1, external_id: null, etag: null, updated_at: at, ext_synced_at: at });

/** Occurrence keys a Google series already has as edited instances (its linked children). */
function instanceKeys(s: Store, seriesId: string, seriesExt: string, tz: string): Set<string> {
  const keys = new Set<string>();
  for (const e of s.events.values())
    if (e.recurrenceParentId === seriesId && !e.deletedAt && e.link?.externalId) {
      const k = core.googleInstanceKey(e.link.externalId, seriesExt, tz);
      if (k) keys.add(k);
    }
  return keys;
}

function addExdate(s: Store, id: string, key: string) {
  const e = s.events.get(id);
  if (e?.recurrence && !e.recurrence.exdates.includes(key)) s.put(id, { exdates: JSON.stringify([...e.recurrence.exdates, key]) });
}

/** Applies pulled changes: provider wins whenever it changed the event (`remoteChanged`). Returns the ids it saw. */
async function apply(s: Store, p: CalProvider, cal: Cal, changes: Change[], tz: string, at: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const idOf = async (ext: string) => s.byExt.get(`${cal.id}|${ext}`) ?? (await stableId(p, cal.id, ext));
  // Series before their edited instances, removals last.
  const order = (c: Change) => (c.kind === "remove" ? 2 : c.event.series ? 1 : 0);
  for (const c of [...changes].sort((a, b) => order(a) - order(b))) {
    if (c.kind === "remove") {
      if (c.series) addExdate(s, await idOf(c.series.externalId), c.series.key);
      const id = s.byExt.get(`${cal.id}|${c.externalId}`);
      if (id && !s.events.get(id)?.deletedAt) s.put(id, gone(at));
      continue;
    }
    const m: Mapped = c.event;
    const id = await idOf(m.externalId);
    seen.add(id);
    const cur = s.events.get(id);
    if (!core.remoteChanged(cur, m)) continue;
    const fields: Record<string, unknown> = { ...core.toRowFields(m, p, at, m.recurrence && p === "google" ? [...instanceKeys(s, id, m.externalId, tz)] : []), _purged: null };
    if (!cur) Object.assign(fields, { id, created_at: at, color: cal.color, pinned: 0, countdown: null, subscription_id: null, source: cal.canEdit ? "local" : "ics", recurrence_parent_id: null });
    if (m.series) {
      // An instance whose series isn't here (outside the window) is just an event.
      const parent = await idOf(m.series.externalId);
      fields.recurrence_parent_id = s.events.has(parent) ? parent : null;
      addExdate(s, parent, m.series.key);
    }
    s.put(id, fields);
  }
  return seen;
}

const startOf = (e: CalendarEvent) => (e.schedule.kind === "timed" ? e.schedule.start : e.schedule.kind === "day" ? `${e.schedule.date}T23:59:59Z` : "");

/** Sends one Momentum change to the provider. A 412 means the provider changed it meanwhile: its version wins. */
async function push(c: Ctx, s: Store, a: Account, access: string, e: CalendarEvent, action: "create" | "update" | "delete", tz: string, at: string) {
  const g = a.provider === "google";
  const cal = e.link?.calendarId ?? a.write_calendar_id!;
  const ext = e.link?.externalId ?? "";
  const one = g ? `${GOOGLE}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(ext)}` : `${GRAPH}/me/events/${encodeURIComponent(ext)}`;
  const ifMatch = e.link?.etag ? { "if-match": e.link.etag } : undefined;
  const linked = (j: Record<string, unknown>) => ({ provider: a.provider, external_calendar_id: cal, ...(typeof j.id === "string" ? { external_id: j.id } : {}), etag: String((g ? j.etag : j["@odata.etag"]) ?? ""), ext_synced_at: e.updatedAt });
  const body = () => (g ? core.toGoogle(e, tz, e.recurrence && ext ? instanceKeys(s, e.id, ext, tz) : new Set()) : core.toGraph(e));

  if (action === "create") {
    const url = g ? `${GOOGLE}/calendars/${encodeURIComponent(cal)}/events` : `${GRAPH}/me/calendars/${encodeURIComponent(cal)}/events`;
    // A copy detached from a linked series becomes its own event there; the series' exdate skips that occurrence.
    s.put(e.id, linked(await ok(await api(c.f, access, url, { method: "POST", body: body() }), "create")));
    return;
  }
  const r = await api(c.f, access, one, action === "update" ? { method: "PATCH", body: body(), headers: ifMatch } : { method: "DELETE", headers: ifMatch });
  if (r.status === 412) {
    const latest = await ok(await api(c.f, access, one), "refetch");
    const change = g ? core.fromGoogle(latest, cal, tz) : core.fromGraph(latest, cal);
    const calInfo = a.calendars.find((x) => x.id === cal) ?? { id: cal, name: "", color: null, primary: false, canEdit: true, sync: true };
    if (change) {
      // Make the local copy look stale so apply() takes the provider's version.
      s.put(e.id, { etag: "" });
      await apply(s, a.provider, calInfo, [change], tz, at);
    }
    return;
  }
  if (r.status === 404 || r.status === 410) {
    // Gone on the provider: an edit can't land, and a delete is done.
    s.put(e.id, action === "delete" ? { external_id: null, etag: null, ext_synced_at: e.updatedAt } : gone(at));
    return;
  }
  if (action === "delete") {
    if (!r.ok) throw new HttpError("delete", r.status);
    s.put(e.id, { external_id: null, etag: null, ext_synced_at: e.updatedAt });
    return;
  }
  s.put(e.id, linked(await ok(r, "update")));
}

const MAX_PUSHES = 100;

/** Pull every synced calendar, then push Momentum's changes. Records the outcome on the account; returns its error. */
export async function syncAccount(c: Ctx, a: Account): Promise<string | null> {
  const at = new Date(c.now).toISOString();
  let error: string | null = null;
  const cursors = { ...a.cursors };
  try {
    const access = await accessFor(c, a);
    const tz = await zoneOf(c.db, a.user_id);
    const s = await eventsOf(c.db, a.user_id);
    for (const cal of a.calendars.filter((x) => x.sync)) {
      let res = await pull(c.f, a.provider, access, cal, cursors[cal.id], tz, c.now);
      if (res === "reset") res = await pull(c.f, a.provider, access, cal, undefined, tz, c.now);
      if (res === "reset") continue;
      const seen = await apply(s, a.provider, cal, res.changes, tz, at);
      // A whole read: what's missing in the window was deleted on the provider.
      if (res.full)
        for (const e of s.events.values())
          if (e.link?.provider === a.provider && e.link.calendarId === cal.id && e.link.externalId && !e.deletedAt && !seen.has(e.id) && startOf(e) >= res.from) s.put(e.id, { ...gone(at) });
      if (res.cursor) cursors[cal.id] = res.cursor;
      else delete cursors[cal.id];
    }
    await s.flush();

    const linkedAcct: LinkedAccount = { provider: a.provider, writeCalendarId: a.write_calendar_id, connectedAt: a.connected_at };
    const writable = new Set(a.calendars.filter((x) => x.canEdit).map((x) => x.id));
    let pushes = 0, failed = 0;
    for (const e of [...s.events.values()]) {
      const action = core.pushAction(e, linkedAcct);
      if (!action || !writable.has(e.link?.calendarId ?? a.write_calendar_id ?? "")) continue;
      if (++pushes > MAX_PUSHES) break; // ponytail: the rest go next run; batch requests if accounts hit this
      try {
        await push(c, s, a, access, e, action, tz, at);
      } catch (err) {
        failed++;
        console.error("calendar push failed", a.provider, action, err instanceof HttpError ? err.message : String(err).slice(0, 200));
      }
    }
    await s.flush();
    if (failed) error = `${failed} change${failed === 1 ? "" : "s"} couldn't be sent to ${NAME[a.provider]}. Momentum tries again on the next sync.`;
  } catch (err) {
    error = err instanceof Reconnect ? `Reconnect ${NAME[a.provider]}: its access was removed or expired.` : `Couldn't sync with ${NAME[a.provider]}. Momentum tries again shortly.`;
    console.error("calendar sync failed", a.provider, err instanceof HttpError ? err.message : err instanceof Reconnect ? "reconnect" : String(err).slice(0, 200));
  }
  await c.db.from("calendar_accounts").update({ cursors, last_sync: at, error }).eq("id", a.id);
  return error;
}

// ---------- endpoints ----------

async function userOf(req: Request, db: SupabaseClient): Promise<string | null> {
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data.user?.id ?? null;
}

const ACCOUNT_COLS = "id, user_id, provider, email, calendars, write_calendar_id, cursors, connected_at, last_sync, error";
const TICKET_MS = 2 * 60_000;
const STATE_MS = 10 * 60_000;
const COOKIE = "cal_state";

/** Step 1 (app, signed in): a short-lived link that carries who is connecting into the browser. */
async function startConnect(c: Ctx, user: string, p: CalProvider): Promise<Response> {
  if (!creds(c.env, p) || !c.env.CALENDAR_STATE_SECRET) return json({ error: `${NAME[p]} isn't set up on this server` }, 404);
  const t = await signToken(c.env.CALENDAR_STATE_SECRET, TICKET_MS, c.now, ["t", user, p]);
  return json({ url: `${base(c.env)}/connect/${p}?t=${encodeURIComponent(t)}` });
}

/** Step 2 (browser): the state names the user and is signed and expiring; its nonce also goes in a cookie, so only this browser can finish (as SOC-21). */
async function connect(c: Ctx, url: URL, p: CalProvider): Promise<Response> {
  const cr = creds(c.env, p);
  const secret = c.env.CALENDAR_STATE_SECRET ?? "";
  const t = await readToken(secret, url.searchParams.get("t"), c.now);
  if (!cr || !t || t[0] !== "t" || t[2] !== p) return page("This connect link expired. Start again from Momentum's settings.", 400);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const state = await signToken(secret, STATE_MS, c.now, ["s", t[1], p, nonce]);
  const q = new URLSearchParams({
    client_id: cr.id, redirect_uri: redirectUri(c.env, p), response_type: "code", scope: cr.scope, state,
    code_challenge: await pkceChallenge(await pkceVerifier(secret, nonce)), code_challenge_method: "S256", ...cr.extra,
  });
  return new Response(null, {
    status: 302,
    headers: { location: `${cr.auth}?${q}`, "set-cookie": `${COOKIE}=${nonce}; Max-Age=${STATE_MS / 1000}; Path=/; HttpOnly; Secure; SameSite=Lax` },
  });
}

/** Step 3 (browser, back from the provider): store the grant and the calendars, then sync once. */
async function callback(c: Ctx, req: Request, url: URL, p: CalProvider, opts: Opts): Promise<Response> {
  const cr = creds(c.env, p);
  const secret = c.env.CALENDAR_STATE_SECRET ?? "";
  const s = await readToken(secret, url.searchParams.get("state"), c.now);
  const kept = new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]+)`).exec(req.headers.get("cookie") ?? "")?.[1] ?? "";
  if (!cr || !s || s[0] !== "s" || s[2] !== p || !same(kept, s[3])) return page("This sign-in expired or wasn't started here. Start again from Momentum's settings.", 400);
  const code = url.searchParams.get("code");
  if (!code) return page(`${NAME[p]} didn't give access, so nothing was connected. You can close this tab.`, 400);
  const user = s[1];
  const { data: allowed } = await c.db.rpc("hit_rate", { p_key: `calendar-connect:${user}`, p_max: 20, p_window: "1 hour" });
  if (!allowed) return page("Too many tries. Try again later.", 429);
  try {
    const t = await tokenCall(c.f, cr, { grant_type: "authorization_code", code, redirect_uri: redirectUri(c.env, p), code_verifier: await pkceVerifier(secret, s[3]) }, "code");
    if (!t.refresh) return page(`${NAME[p]} didn't allow offline access. Remove Momentum from your account's connected apps and connect again.`, 400);
    // A reconnect keeps the calendars the user had chosen.
    const { data: before } = await c.db.from("calendar_accounts").select("calendars").eq("user_id", user).eq("provider", p).maybeSingle();
    const calendars = await listCalendars(c.f, p, t.access, Array.isArray(before?.calendars) ? before.calendars : []);
    const email = await accountEmail(c.f, p, t.access, calendars);
    const { data: acct, error } = await c.db.from("calendar_accounts")
      .upsert({ user_id: user, provider: p, email, calendars, cursors: {}, connected_at: new Date(c.now).toISOString(), error: null }, { onConflict: "user_id,provider" })
      .select(ACCOUNT_COLS).single();
    if (error || !acct) throw error ?? new Error("no account row");
    const sealed = await seal(c.env.CALENDAR_TOKEN_KEY, t.refresh, acct.id);
    const saved = await c.db.from("calendar_tokens").upsert({ account_id: acct.id, refresh_token: sealed });
    if (saved.error) throw saved.error;
    opts.waitUntil?.(syncAccount(c, acct as Account).catch(() => undefined));
    return page(`${NAME[p]} is connected${email ? ` as ${email}` : ""}. You can close this tab and go back to Momentum.`);
  } catch (err) {
    console.error("calendar connect failed", p, err instanceof HttpError ? err.message : String(err).slice(0, 200));
    return page(`Couldn't connect ${NAME[p]}. Close this tab and try again from Momentum.`, 502);
  }
}

async function accountsOf(db: SupabaseClient, user: string): Promise<Account[]> {
  const { data, error } = await db.from("calendar_accounts").select(ACCOUNT_COLS).eq("user_id", user);
  if (error) throw error;
  return data as Account[];
}

const view = (a: Account) => ({ provider: a.provider, email: a.email, calendars: a.calendars, writeCalendarId: a.write_calendar_id, lastSync: a.last_sync, error: a.error });

/** The user's accounts, with each calendar list refreshed from the provider. */
async function list(c: Ctx, user: string): Promise<Response> {
  const out = [];
  for (const a of await accountsOf(c.db, user)) {
    try {
      const calendars = await listCalendars(c.f, a.provider, await accessFor(c, a), a.calendars);
      const write = calendars.some((x) => x.id === a.write_calendar_id && x.canEdit) ? a.write_calendar_id : null;
      await c.db.from("calendar_accounts").update({ calendars, write_calendar_id: write }).eq("id", a.id);
      out.push(view({ ...a, calendars, write_calendar_id: write }));
    } catch (err) {
      out.push(view({ ...a, error: a.error ?? (err instanceof Reconnect ? `Reconnect ${NAME[a.provider]}: its access was removed or expired.` : null) }));
    }
  }
  return json({ accounts: out });
}

/** Marks the provider's events of these calendars gone, or (keep) turns them into Momentum-only events. */
async function dropEvents(c: Ctx, user: string, p: CalProvider, calendars: Set<string> | null, keep: boolean) {
  const s = await eventsOf(c.db, user);
  const at = new Date(c.now).toISOString();
  const unlink = { provider: null, external_calendar_id: null, external_id: null, etag: null, ext_synced_at: null };
  for (const e of s.events.values())
    if (e.link?.provider === p && (!calendars || calendars.has(e.link.calendarId)) && !e.deletedAt) s.put(e.id, keep ? { ...unlink, updated_at: at } : { ...gone(at), ...unlink });
  await s.flush();
}

async function choose(c: Ctx, user: string, p: CalProvider, body: unknown, opts: Opts): Promise<Response> {
  const b = body as { sync?: unknown; write?: unknown } | null;
  if (!Array.isArray(b?.sync) || b.sync.length > 100 || !b.sync.every((x) => typeof x === "string") || (b.write !== null && typeof b.write !== "string"))
    return json({ error: "send { sync: string[], write: string | null }" }, 400);
  const a = (await accountsOf(c.db, user)).find((x) => x.provider === p);
  if (!a) return json({ error: "not connected" }, 404);
  const want = new Set(b.sync as string[]);
  const write = typeof b.write === "string" && a.calendars.some((x) => x.id === b.write && x.canEdit) ? b.write : null;
  const dropped = new Set(a.calendars.filter((x) => x.sync && !want.has(x.id)).map((x) => x.id));
  const calendars = a.calendars.map((x) => ({ ...x, sync: want.has(x.id) }));
  const cursors = Object.fromEntries(Object.entries(a.cursors).filter(([k]) => !dropped.has(k)));
  await c.db.from("calendar_accounts").update({ calendars, write_calendar_id: write, cursors }).eq("id", a.id);
  // One calendar gets new events: choosing one here clears the other provider's choice.
  if (write) await c.db.from("calendar_accounts").update({ write_calendar_id: null }).eq("user_id", user).neq("id", a.id);
  if (dropped.size) await dropEvents(c, user, p, dropped, false);
  opts.waitUntil?.(syncAccount(c, { ...a, calendars, write_calendar_id: write, cursors }).catch(() => undefined));
  return json({ ok: true });
}

async function disconnect(c: Ctx, user: string, p: CalProvider, body: unknown): Promise<Response> {
  const a = (await accountsOf(c.db, user)).find((x) => x.provider === p);
  if (!a) return json({ ok: true });
  if (p === "google") {
    // Revoke the grant at Google too (best effort). Microsoft has no revoke call: the user removes the app at myapps / account.live.com.
    try {
      const { data } = await c.db.from("calendar_tokens").select("refresh_token").eq("account_id", a.id).maybeSingle();
      if (data) await c.f("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: await unseal(c.env.CALENDAR_TOKEN_KEY, data.refresh_token, a.id) }) });
    } catch {
      console.error("calendar revoke failed", p);
    }
  }
  const { error } = await c.db.from("calendar_accounts").delete().eq("id", a.id);
  if (error) throw error;
  await dropEvents(c, user, p, null, (body as { keep?: unknown } | null)?.keep === true);
  return json({ ok: true });
}

const CRON_BATCH = 25;

export async function handle(req: Request, env: Env, opts: Opts = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/calendar(?=\/|$)/, "");
  const db = createClient(env.SUPABASE_URL ?? "", env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
  const c: Ctx = { db, env, f: opts.fetch ?? fetch, now: opts.now?.() ?? Date.now() };
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const [, verb, arg] = path.split("/");
    if (req.method === "GET" && verb === "connect" && isProvider(arg)) return await connect(c, url, arg);
    if (req.method === "GET" && verb === "callback" && isProvider(arg)) return await callback(c, req, url, arg, opts);
    if (req.method === "POST" && verb === "cron") {
      if (!same(req.headers.get("x-cron-secret") ?? "", env.CALENDAR_CRON_SECRET ?? "")) return json({ error: "bad secret" }, 401);
      const { data, error } = await db.from("calendar_accounts").select(ACCOUNT_COLS).order("last_sync", { ascending: true, nullsFirst: true }).limit(CRON_BATCH);
      if (error) throw error;
      const work = Promise.all((data as Account[]).map((a) => syncAccount(c, a)));
      opts.waitUntil ? opts.waitUntil(work) : await work;
      return json({ accounts: data.length });
    }

    const user = await userOf(req, db);
    if (!user) return json({ error: "sign in" }, 401);
    if (req.method === "POST" && verb === "connect" && isProvider(arg)) return await startConnect(c, user, arg);
    if (req.method === "GET" && verb === "list") return await list(c, user);
    if (req.method === "POST" && verb === "calendars" && isProvider(arg)) return await choose(c, user, arg, await req.json().catch(() => null), opts);
    if (req.method === "POST" && verb === "disconnect" && isProvider(arg)) return await disconnect(c, user, arg, await req.json().catch(() => null));
    if (req.method === "POST" && verb === "sync") {
      const { data: allowed } = await db.rpc("hit_rate", { p_key: `calendar-sync:${user}`, p_max: 120, p_window: "1 hour" });
      if (!allowed) return json({ error: "too many syncs" }, 429);
      const accounts = await accountsOf(db, user);
      const errors = await Promise.all(accounts.map((a) => syncAccount(c, a)));
      return json({ accounts: accounts.map((a, i) => ({ provider: a.provider, error: errors[i] })) });
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error("calendar function error", e instanceof HttpError ? e.message : String(e).slice(0, 200));
    return json({ error: "server error" }, 500);
  }
}
