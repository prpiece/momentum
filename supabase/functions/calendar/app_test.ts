// Deno tests for the calendar function's secrets and OAuth redirects: `deno test` in this folder.
// The sync itself needs a database and provider accounts; its mapping is tested in src/domain/calendarSync.test.ts.
import { assert, assertEquals, assertMatch, assertRejects } from "jsr:@std/assert@1";
import { handle, pkceVerifier, readToken, seal, signToken, unseal, type Env } from "./app.ts";

const NOW = 1_800_000_000_000;
const env: Env = {
  SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "service",
  GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsecret", MS_CLIENT_ID: "mid", MS_CLIENT_SECRET: "msecret",
  CALENDAR_STATE_SECRET: "state-secret", CALENDAR_CRON_SECRET: "cron", CALENDAR_PUBLIC_URL: "https://ref.supabase.co/functions/v1/calendar",
  CALENDAR_TOKEN_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
};
const opts = { now: () => NOW, fetch: () => Promise.reject(new Error("no network in tests")) };

Deno.test("signed tokens expire, and any change breaks them", async () => {
  const t = await signToken("s", 60_000, NOW, ["t", "user", "google"]);
  assertEquals(await readToken("s", t, NOW), ["t", "user", "google"]);
  assertEquals(await readToken("s", t, NOW + 60_001), null);
  assertEquals(await readToken("other", t, NOW), null);
  assertEquals(await readToken("s", t.replace("user", "evil"), NOW), null);
  assertEquals(await readToken("", t, NOW), null);
  assertEquals(await readToken("s", null, NOW), null);
});

Deno.test("refresh tokens are sealed per account", async () => {
  const sealed = await seal(env.CALENDAR_TOKEN_KEY, "1//refresh", "acct-1");
  assert(!sealed.includes("refresh"));
  assertEquals(await unseal(env.CALENDAR_TOKEN_KEY, sealed, "acct-1"), "1//refresh");
  await assertRejects(() => unseal(env.CALENDAR_TOKEN_KEY, sealed, "acct-2"));
  await assertRejects(() => seal("c2hvcnQ=", "x", "a"), Error, "32 random bytes");
});

Deno.test("PKCE verifiers are derived and well-formed", async () => {
  const v = await pkceVerifier("s", "abc");
  assertMatch(v, /^[A-Za-z0-9_-]{43}$/);
  assertEquals(v, await pkceVerifier("s", "abc"));
});

Deno.test("connect sends the browser to Google with PKCE, a signed state and its cookie", async () => {
  const t = await signToken(env.CALENDAR_STATE_SECRET!, 60_000, NOW, ["t", "user-1", "google"]);
  const r = await handle(new Request(`https://x/functions/v1/calendar/connect/google?t=${encodeURIComponent(t)}`), env, opts);
  assertEquals(r.status, 302);
  const to = new URL(r.headers.get("location")!);
  assertEquals(to.origin + to.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assertEquals(to.searchParams.get("redirect_uri"), "https://ref.supabase.co/functions/v1/calendar/callback/google");
  assertEquals(to.searchParams.get("code_challenge_method"), "S256");
  assertEquals(to.searchParams.get("access_type"), "offline");
  const state = await readToken(env.CALENDAR_STATE_SECRET!, to.searchParams.get("state"), NOW);
  assertEquals(state?.slice(0, 3), ["s", "user-1", "google"]);
  assertMatch(r.headers.get("set-cookie")!, new RegExp(`^cal_state=${state![3]};.*HttpOnly; Secure`));
});

Deno.test("connect refuses expired, foreign or mismatched links", async () => {
  const forMs = await signToken(env.CALENDAR_STATE_SECRET!, 60_000, NOW, ["t", "user-1", "microsoft"]);
  const asState = await signToken(env.CALENDAR_STATE_SECRET!, 60_000, NOW, ["s", "user-1", "google", "n"]);
  for (const t of [forMs, asState, "junk"]) {
    const r = await handle(new Request(`https://x/functions/v1/calendar/connect/google?t=${encodeURIComponent(t)}`), env, opts);
    assertEquals(r.status, 400);
  }
});

Deno.test("the callback needs the state's own browser", async () => {
  const state = await signToken(env.CALENDAR_STATE_SECRET!, 60_000, NOW, ["s", "user-1", "google", "abcd"]);
  const at = `https://x/functions/v1/calendar/callback/google?code=c&state=${encodeURIComponent(state)}`;
  assertEquals((await handle(new Request(at), env, opts)).status, 400);
  assertEquals((await handle(new Request(at, { headers: { cookie: "cal_state=ffff" } }), env, opts)).status, 400);
  const wrongProvider = `https://x/functions/v1/calendar/callback/microsoft?code=c&state=${encodeURIComponent(state)}`;
  assertEquals((await handle(new Request(wrongProvider, { headers: { cookie: "cal_state=abcd" } }), env, opts)).status, 400);
});

Deno.test("cron needs its secret; user routes need a sign-in", async () => {
  assertEquals((await handle(new Request("https://x/functions/v1/calendar/cron", { method: "POST" }), env, opts)).status, 401);
  assertEquals((await handle(new Request("https://x/functions/v1/calendar/sync", { method: "POST" }), env, opts)).status, 401);
});

// ---------- one sync against a fake database and a fake Google ----------

type Row = { id: string; data: Record<string, unknown> };

/** Just enough of the Supabase client for syncAccount: filtered reads, updates, and calendar_write. */
function fakeDb(rows: Map<string, Row>, sealed: string, log: { updates: Record<string, unknown>[] }) {
  const table = (name: string) => {
    let update: Record<string, unknown> | null = null;
    const data = () =>
      name === "sync_rows" ? [...rows.values()]
        : name === "profiles" ? [{ time_zone: "America/New_York" }]
        : name === "calendar_tokens" ? [{ refresh_token: sealed }] : [];
    const q = {
      select: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => q,
      update: (p: Record<string, unknown>) => ((update = p), q),
      range: () => Promise.resolve({ data: data(), error: null }),
      maybeSingle: () => Promise.resolve({ data: data()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => {
        if (update) log.updates.push(update);
        return Promise.resolve({ data: null, error: null }).then(ok);
      },
    };
    return q;
  };
  return {
    from: table,
    rpc: (fn: string, args: { p_rows: { id: string; fields: Record<string, unknown> }[] }) => {
      if (fn === "calendar_write") for (const r of args.p_rows) rows.set(r.id, { id: r.id, data: { ...rows.get(r.id)?.data, ...r.fields } });
      return Promise.resolve({ data: true, error: null });
    },
  };
}

Deno.test("a sync pulls a series and its edited instance, creates a new Momentum event, and lets Google win a conflict", async () => {
  const { syncAccount } = await import("./app.ts");
  const acct = {
    id: "acct-1", user_id: "user-1", provider: "google" as const, email: "me@example.com", write_calendar_id: "primary",
    calendars: [{ id: "primary", name: "Me", color: "#123456", primary: true, canEdit: true, sync: true }],
    // Incremental: a first full read would (rightly) drop "edited", which isn't in the page.
    cursors: { primary: { c: "tok0", at: "2026-11-15T00:00:00.000Z" } }, connected_at: "2026-11-01T00:00:00.000Z", last_sync: null, error: null,
  };
  const at = "2026-11-10T00:00:00.000Z";
  const rows = new Map<string, Row>([
    ["new-local", { id: "new-local", data: { title: "Dentist", start_at: "2026-11-20T15:00:00.000Z", end_at: "2026-11-20T16:00:00.000Z", source: "local", created_at: at, updated_at: at } }],
    ["edited", { id: "edited", data: { title: "Mine", start_date: "2026-11-21", source: "local", created_at: at, updated_at: "2026-11-12T00:00:00.000Z",
      provider: "google", external_calendar_id: "primary", external_id: "e1", etag: '"1"', ext_synced_at: at } }],
  ]);
  const log = { updates: [] as Record<string, unknown>[] };
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url), m = init?.method ?? "GET";
    calls.push(`${m} ${u.split("?")[0]}`);
    if (u.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "at" });
    if (m === "GET" && u.includes("/calendars/primary/events?"))
      return Response.json({ nextSyncToken: "tok1", items: [
        { id: "s", etag: '"a"', summary: "Weekly", start: { dateTime: "2026-11-02T14:00:00Z", timeZone: "America/New_York" }, end: { dateTime: "2026-11-02T15:00:00Z", timeZone: "America/New_York" }, recurrence: ["RRULE:FREQ=WEEKLY"] },
        { id: "s_20261109T140000Z", etag: '"b"', recurringEventId: "s", originalStartTime: { dateTime: "2026-11-09T14:00:00Z" }, summary: "Weekly (moved)", start: { dateTime: "2026-11-09T16:00:00Z" }, end: { dateTime: "2026-11-09T17:00:00Z" } },
      ] });
    if (m === "POST" && u.endsWith("/calendars/primary/events")) return Response.json({ id: "created", etag: '"c"' });
    if (m === "PATCH" && u.endsWith("/events/e1")) return new Response(null, { status: 412 });
    if (m === "GET" && u.endsWith("/events/e1")) return Response.json({ id: "e1", etag: '"2"', summary: "Theirs", start: { date: "2026-11-22" }, end: { date: "2026-11-23" } });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  const sealed = await seal(env.CALENDAR_TOKEN_KEY, "refresh", "acct-1");
  // deno-lint-ignore no-explicit-any
  const error = await syncAccount({ db: fakeDb(rows, sealed, log) as any, env, f, now: Date.parse("2026-11-17T12:00:00Z") }, acct);

  assertEquals(error, null);
  const all = [...rows.values()];
  const series = all.find((r) => r.data.external_id === "s")!;
  const moved = all.find((r) => r.data.external_id === "s_20261109T140000Z")!;
  assertMatch(series.id, /^cal-g-[0-9a-f]{32}$/);
  assertEquals(series.data.rrule, "DTSTART;TZID=America/New_York:20261102T090000\nRRULE:FREQ=WEEKLY");
  assertEquals(JSON.parse(String(series.data.exdates)), ["2026-11-09T09:00"]);
  assertEquals(series.data.color, "#123456");
  assertEquals(moved.data.recurrence_parent_id, series.id);
  assertEquals(rows.get("new-local")!.data.external_id, "created");
  assertEquals(rows.get("new-local")!.data.ext_synced_at, at);
  assertEquals(rows.get("edited")!.data.title, "Theirs");
  assertEquals(rows.get("edited")!.data.start_date, "2026-11-22");
  assertEquals(log.updates.at(-1)?.cursors, { primary: { c: "tok1", at: "2026-11-15T00:00:00.000Z" } });
  assert(calls.includes("PATCH https://www.googleapis.com/calendar/v3/calendars/primary/events/e1"));
  assert(calls.some((c) => c.startsWith("GET https://www.googleapis.com/calendar/v3/calendars/primary/events")));
});

Deno.test("a first full read removes linked events the provider no longer has", async () => {
  const { syncAccount } = await import("./app.ts");
  const rows = new Map<string, Row>([["old", { id: "old", data: { title: "Gone", start_date: "2026-11-21", source: "local", created_at: "2026-11-10T00:00:00.000Z", updated_at: "2026-11-10T00:00:00.000Z",
    provider: "google", external_calendar_id: "primary", external_id: "e9", etag: '"1"', ext_synced_at: "2026-11-10T00:00:00.000Z" } }]]);
  const f = (async (url: string) => String(url).includes("oauth2") ? Response.json({ access_token: "at" }) : Response.json({ items: [], nextSyncToken: "t" })) as typeof fetch;
  const acct = { id: "a", user_id: "u", provider: "google" as const, email: null, write_calendar_id: null, calendars: [{ id: "primary", name: "Me", color: null, primary: true, canEdit: true, sync: true }],
    cursors: {}, connected_at: "2026-11-01T00:00:00.000Z", last_sync: null, error: null };
  // deno-lint-ignore no-explicit-any
  await syncAccount({ db: fakeDb(rows, await seal(env.CALENDAR_TOKEN_KEY, "r", "a"), { updates: [] }) as any, env, f, now: Date.parse("2026-11-17T12:00:00Z") }, acct);
  assertEquals(rows.get("old")!.data._purged, 1);
  assertEquals(rows.get("old")!.data.external_id, null);
});
