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

const BASE = "https://x/functions/v1/calendar";
const UID = "11111111-1111-4111-8111-111111111111";
const ticket = (user = UID, p = "google") => signToken(env.CALENDAR_STATE_SECRET!, 60_000, NOW, ["t", user, p]);
/** Runs fn with the Supabase auth admin lookup answered by a stub. */
async function withUser<T>(email: string | null, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(email === null ? new Response("{}", { status: 404 }) : Response.json({ id: "user-1", email, aud: "authenticated" }));
  try { return await fn(); } finally { globalThis.fetch = real; }
}

Deno.test("opening a connect link only shows a confirmation; nothing is linked or redirected", async () => {
  const t = await ticket();
  const r = await withUser("mallory@evil.test", () => handle(new Request(`${BASE}/connect/google?t=${encodeURIComponent(t)}`), env, opts));
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("location"), null);
  assertMatch(r.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assertEquals(r.headers.get("x-frame-options"), "DENY");
  const body = await r.text();
  assert(body.includes("m***@e***.test") && !body.includes("mallory@evil.test"));
  assertMatch(r.headers.get("set-cookie")!, /^cal_confirm=[0-9a-f]{32};.*HttpOnly; Secure/);
  assert(!(r.headers.get("set-cookie") ?? "").includes("cal_state"));
});

Deno.test("confirming in the same browser sends it to Google with PKCE, a signed state and its cookie", async () => {
  const t = await ticket();
  const post = (cookie: string, n: string, tok = t) => handle(new Request(`${BASE}/confirm/google`, {
    method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: tok, n }),
  }), env, opts);
  const r = await post("cal_confirm=abcd", "abcd");
  assertEquals(r.status, 302);
  const to = new URL(r.headers.get("location")!);
  assertEquals(to.origin + to.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assertEquals(to.searchParams.get("redirect_uri"), "https://ref.supabase.co/functions/v1/calendar/callback/google");
  assertEquals(to.searchParams.get("code_challenge_method"), "S256");
  assertEquals(to.searchParams.get("access_type"), "offline");
  const state = await readToken(env.CALENDAR_STATE_SECRET!, to.searchParams.get("state"), NOW);
  assertEquals(state?.slice(0, 3), ["s", UID, "google"]);
  assertMatch(r.headers.get("set-cookie")!, new RegExp(`^cal_state=${state![3]};.*HttpOnly; Secure`));
  // A forged cross-site post carries the attacker's ticket but not the victim's confirm cookie.
  assertEquals((await post("", "abcd")).status, 400);
  assertEquals((await post("cal_confirm=ffff", "abcd")).status, 400);
});

Deno.test("connect and confirm refuse expired, foreign or mismatched tickets", async () => {
  const forMs = await ticket(UID, "microsoft");
  const asState = await signToken(env.CALENDAR_STATE_SECRET!, 60_000, NOW, ["s", "user-1", "google", "n"]);
  const expired = await signToken(env.CALENDAR_STATE_SECRET!, -1, NOW, ["t", UID, "google"]);
  for (const t of [forMs, asState, expired, "junk"]) {
    assertEquals((await handle(new Request(`${BASE}/connect/google?t=${encodeURIComponent(t)}`), env, opts)).status, 400);
    const r = await handle(new Request(`${BASE}/confirm/google`, { method: "POST", headers: { cookie: "cal_confirm=abcd" }, body: new URLSearchParams({ t, n: "abcd" }) }), env, opts);
    assertEquals(r.status, 400);
  }
});

Deno.test("connect fails closed when the account can't be looked up", async () => {
  const r = await withUser(null, async () => handle(new Request(`${BASE}/connect/google?t=${encodeURIComponent(await ticket())}`), env, opts));
  assertEquals(r.status, 502);
});

Deno.test("the confirmation page is English HTML with a short, strict confirm cookie", async () => {
  const r = await withUser("a@b.test", async () => handle(new Request(`${BASE}/connect/google?t=${encodeURIComponent(await ticket())}`), env, opts));
  assertMatch(await r.text(), /^<!doctype html><html lang="en">/);
  assertMatch(r.headers.get("set-cookie")!, /^cal_confirm=[0-9a-f]{32}; Max-Age=120; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
});

Deno.test("the account name is HTML-escaped", async () => {
  const r = await withUser('<"@<.test', async () => handle(new Request(`${BASE}/connect/google?t=${encodeURIComponent(await ticket())}`), env, opts));
  const body = await r.text();
  assert(body.includes("&#60;***@&#60;***.test"));
  assert(!body.includes("<***"));
});

Deno.test("confirm without its form fields is refused", async () => {
  const t = await ticket();
  for (const form of [{ t }, { n: "abcd" }, {}] as Record<string, string>[]) {
    const r = await handle(new Request(`${BASE}/confirm/google`, { method: "POST", headers: { cookie: "cal_confirm=abcd" }, body: new URLSearchParams(form) }), env, opts);
    assertEquals(r.status, 400);
  }
});

Deno.test("starting a connect is rate-limited", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = String(input instanceof Request ? input.url : input);
    return Promise.resolve(u.includes("/rpc/hit_rate") ? Response.json(false) : Response.json({ id: UID, aud: "authenticated" }));
  };
  try {
    const r = await handle(new Request(`${BASE}/connect/google`, { method: "POST", headers: { authorization: "Bearer tok" } }), env, opts);
    assertEquals(r.status, 429);
  } finally { globalThis.fetch = real; }
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
  assertEquals(log.updates.findLast((u) => "cursors" in u)?.cursors, { primary: { c: "tok1", at: "2026-11-15T00:00:00.000Z" } });
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

Deno.test("a failing calendar neither loses another's events nor moves its own cursor", async () => {
  const { syncAccount } = await import("./app.ts");
  const cal = (id: string) => ({ id, name: id, color: null, primary: false, canEdit: false, sync: true });
  const acct = {
    id: "acct-1", user_id: "user-1", provider: "google" as const, email: "me@example.com", write_calendar_id: null,
    calendars: [cal("a"), cal("b")], cursors: { b: { c: "B0", at: "2026-11-15T00:00:00.000Z" } },
    connected_at: "2026-11-01T00:00:00.000Z", last_sync: null, error: null,
  };
  const rows = new Map<string, Row>();
  const log = { updates: [] as Record<string, unknown>[] };
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "at" });
    if (init?.method !== "POST" && u.includes("/calendars/a/events?"))
      return Response.json({ nextSyncToken: "A1", items: [{ id: "ea", etag: '"1"', summary: "From A", start: { dateTime: "2026-11-20T15:00:00Z" }, end: { dateTime: "2026-11-20T16:00:00Z" } }] });
    return new Response("boom", { status: 500 });
  }) as typeof fetch;
  const sealed = await seal(env.CALENDAR_TOKEN_KEY, "refresh", "acct-1");
  // deno-lint-ignore no-explicit-any
  const error = await syncAccount({ db: fakeDb(rows, sealed, log) as any, env, f, now: Date.parse("2026-11-17T12:00:00Z") }, acct);

  assert(error);
  assertEquals([...rows.values()].filter((r) => r.data.title === "From A").length, 1);
  const saved = log.updates.findLast((u) => "cursors" in u)!.cursors as Record<string, { c: string }>;
  assertEquals(saved.a.c, "A1"); // its events are written, so it may move on
  assertEquals(saved.b.c, "B0"); // the failed pull keeps its old cursor and is read again next time
});

Deno.test("a failed flush leaves the cursor where it was", async () => {
  const { syncAccount } = await import("./app.ts");
  const acct = {
    id: "acct-1", user_id: "user-1", provider: "google" as const, email: "me@example.com", write_calendar_id: null,
    calendars: [{ id: "a", name: "a", color: null, primary: false, canEdit: false, sync: true }], cursors: { a: { c: "A0", at: "2026-11-15T00:00:00.000Z" } },
    connected_at: "2026-11-01T00:00:00.000Z", last_sync: null, error: null,
  };
  const rows = new Map<string, Row>();
  const log = { updates: [] as Record<string, unknown>[] };
  const f = (async (url: string) => String(url).startsWith("https://oauth2.googleapis.com/token") ? Response.json({ access_token: "at" })
    : Response.json({ nextSyncToken: "A1", items: [{ id: "ea", etag: '"1"', summary: "From A", start: { dateTime: "2026-11-20T15:00:00Z" }, end: { dateTime: "2026-11-20T16:00:00Z" } }] })) as typeof fetch;
  const sealed = await seal(env.CALENDAR_TOKEN_KEY, "refresh", "acct-1");
  const base = fakeDb(rows, sealed, log);
  const db = { ...base, rpc: (fn: string, a: never) => (fn === "calendar_write" ? Promise.resolve({ data: null, error: new Error("db down") }) : base.rpc(fn, a)) };
  // deno-lint-ignore no-explicit-any
  assert(await syncAccount({ db: db as any, env, f, now: Date.parse("2026-11-17T12:00:00Z") }, acct));
  assertEquals((log.updates.findLast((u) => "cursors" in u)!.cursors as Record<string, { c: string }>).a.c, "A0");
});

/** A Google that keeps what it is sent: ids given by the caller, 409 on a repeat, and a count of the creates it accepted. */
function fakeGoogle(dedupe = true) {
  const events = new Map<string, Record<string, unknown>>();
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url), m = init?.method ?? "GET";
    if (u.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "at" });
    if (m === "GET" && u.includes("/calendars/primary/events?")) return Response.json({ nextSyncToken: "t", items: [] });
    if (m === "POST" && u.endsWith("/calendars/primary/events")) {
      const b = JSON.parse(String(init!.body));
      if (dedupe && events.has(b.id)) return new Response("{}", { status: 409 });
      events.set(dedupe ? b.id : `${b.id}#${events.size}`, b);
      return Response.json({ id: b.id, etag: '"1"' });
    }
    const got = events.get(decodeURIComponent(u.split("/events/")[1] ?? ""));
    return got ? Response.json({ ...got, etag: '"1"' }) : new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { events, f };
}

const unlinked = () => {
  const at = "2026-11-10T00:00:00.000Z";
  const acct = {
    id: "acct-1", user_id: "user-1", provider: "google" as const, email: "me@example.com", write_calendar_id: "primary",
    calendars: [{ id: "primary", name: "Me", color: null, primary: true, canEdit: true, sync: true }],
    cursors: {}, connected_at: "2026-11-01T00:00:00.000Z", last_sync: null, error: null,
  };
  const rows = new Map<string, Row>([["new-local", { id: "new-local", data: { title: "Dentist", start_at: "2026-11-20T15:00:00.000Z", end_at: "2026-11-20T16:00:00.000Z", source: "local", created_at: at, updated_at: at } }]]);
  return { acct, rows };
};

Deno.test("two overlapping syncs of one account create the event once", async () => {
  const { syncAccount } = await import("./app.ts");
  const { acct, rows } = unlinked();
  const g = fakeGoogle(false); // no provider-side dedupe: only the lock can keep this to one create
  const log = { updates: [] as Record<string, unknown>[] };
  const base = fakeDb(rows, await seal(env.CALENDAR_TOKEN_KEY, "refresh", "acct-1"), log);
  let held = false;
  const db = {
    ...base,
    rpc: (fn: string, a: never) => (fn === "calendar_try_lock" ? ((held ? Promise.resolve({ data: false, error: null }) : ((held = true), Promise.resolve({ data: "lease-1", error: null })))) : base.rpc(fn, a)),
    from: (t: string) => {
      const q = base.from(t);
      const update = q.update;
      q.update = (p: Record<string, unknown>) => (p.sync_until === null && (held = false), update(p));
      return q;
    },
  };
  // deno-lint-ignore no-explicit-any
  const ctx = { db: db as any, env, f: g.f, now: Date.parse("2026-11-17T12:00:00Z") };
  await Promise.all([syncAccount(ctx, acct), syncAccount(ctx, acct)]);
  assertEquals(g.events.size, 1);
});

Deno.test("a create whose link was lost is found again, not created twice", async () => {
  const { syncAccount } = await import("./app.ts");
  const { acct, rows } = unlinked();
  const g = fakeGoogle();
  const log = { updates: [] as Record<string, unknown>[] };
  const base = fakeDb(rows, await seal(env.CALENDAR_TOKEN_KEY, "refresh", "acct-1"), log);
  let down = true;
  const db = { ...base, rpc: (fn: string, a: never) => (fn === "calendar_write" && down ? Promise.resolve({ data: null, error: new Error("db down") }) : base.rpc(fn, a)) };
  // deno-lint-ignore no-explicit-any
  const ctx = { db: db as any, env, f: g.f, now: Date.parse("2026-11-17T12:00:00Z") };
  assert(await syncAccount(ctx, acct)); // Google has the event; the link was never saved
  assertEquals(rows.get("new-local")!.data.external_id, undefined);
  down = false;
  assertEquals(await syncAccount(ctx, acct), null);
  assertEquals(g.events.size, 1);
  assertEquals(rows.get("new-local")!.data.external_id, [...g.events.keys()][0]);
});

Deno.test("a sync still runs when the lock can't be asked, and skips only on a definite no", async () => {
  const { syncAccount } = await import("./app.ts");
  const run = async (lock: { data: boolean | null; error: { code: string } | null }) => {
    const { acct, rows } = unlinked();
    const g = fakeGoogle();
    const log = { updates: [] as Record<string, unknown>[] };
    const base = fakeDb(rows, await seal(env.CALENDAR_TOKEN_KEY, "refresh", "acct-1"), log);
    const db = { ...base, rpc: (fn: string, a: never) => (fn === "calendar_try_lock" ? Promise.resolve(lock) : base.rpc(fn, a)) };
    // deno-lint-ignore no-explicit-any
    await syncAccount({ db: db as any, env, f: g.f, now: Date.parse("2026-11-17T12:00:00Z") }, acct);
    return g.events.size;
  };
  assertEquals(await run({ data: null, error: { code: "PGRST202" } }), 1); // function missing: no lock, still syncs
  assertEquals(await run({ data: false, error: null }), 0); // someone else holds it
});

Deno.test("reconnecting keeps connected_at, a first connect uses now", async () => {
  const connect = async (before: Record<string, unknown> | null) => {
    let upserted: Record<string, unknown> | null = null;
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const u = req.url;
      if (u.includes("/rpc/hit_rate")) return Response.json(true);
      if (u.includes("/calendar_tokens")) return new Response(null, { status: 201 });
      if (req.method === "POST" && u.includes("/calendar_accounts")) {
        upserted = JSON.parse(await req.text());
        return Response.json({ id: "acct-1", ...upserted }, { status: 201 });
      }
      if (u.includes("/calendar_accounts")) return before ? Response.json(before) : new Response(null, { status: 406 });
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    try {
      const f = (async (url: string) => String(url).startsWith("https://oauth2.googleapis.com/token") ? Response.json({ access_token: "at", refresh_token: "rt" })
        : Response.json({ items: [{ id: "me@example.com", summary: "Me", primary: true, accessRole: "owner" }] })) as typeof fetch;
      const state = await signToken(env.CALENDAR_STATE_SECRET!, 60_000, NOW, ["s", UID, "google", "abcd"]);
      const r = await handle(new Request(`${BASE}/callback/google?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie: "cal_state=abcd" } }), env, { ...opts, fetch: f });
      assertEquals(r.status, 200);
      return (upserted as { connected_at?: string } | null)?.connected_at;
    } finally { globalThis.fetch = real; }
  };
  assertEquals(await connect({ calendars: [], connected_at: "2026-10-01T00:00:00+00:00" }), "2026-10-01T00:00:00+00:00");
  assertEquals(await connect(null), new Date(NOW).toISOString());
});

Deno.test("a full Outlook read never treats events beyond its window as gone", async () => {
  const { syncAccount } = await import("./app.ts");
  const at = "2026-11-10T00:00:00.000Z";
  const link = { provider: "microsoft", external_calendar_id: "cal", etag: "x", ext_synced_at: at, source: "local", created_at: at, updated_at: at };
  const rows = new Map<string, Row>([
    ["far", { id: "far", data: { ...link, title: "Far", start_date: "2028-01-20", external_id: "m-far" } }],
    ["near", { id: "near", data: { ...link, title: "Near", start_date: "2026-11-21", external_id: "m-near" } }],
  ]);
  const f = (async (url: string) => String(url).includes("login.microsoftonline") ? Response.json({ access_token: "at" }) : Response.json({ value: [] })) as typeof fetch;
  const acct = { id: "a", user_id: "u", provider: "microsoft" as const, email: null, write_calendar_id: null, calendars: [{ id: "cal", name: "C", color: null, primary: false, canEdit: true, sync: true }],
    cursors: {}, connected_at: "2026-11-01T00:00:00.000Z", last_sync: null, error: null };
  // deno-lint-ignore no-explicit-any
  await syncAccount({ db: fakeDb(rows, await seal(env.CALENDAR_TOKEN_KEY, "r", "a"), { updates: [] }) as any, env, f, now: Date.parse("2026-11-17T12:00:00Z") }, acct);
  assertEquals(rows.get("near")!.data._purged, 1); // inside the window and missing: gone
  assertEquals(rows.get("far")!.data._purged, undefined); // outside it: not read, so not gone
  assertEquals(rows.get("far")!.data.external_id, "m-far");
});

Deno.test("re-applying a Google series keeps the occurrences the provider cancelled", async () => {
  const { syncAccount } = await import("./app.ts");
  const at = "2026-11-10T00:00:00.000Z";
  const rows = new Map<string, Row>([["series", { id: "series", data: { title: "Old", start_at: "2026-11-02T14:00:00.000Z", end_at: "2026-11-02T15:00:00.000Z", source: "local", created_at: at, updated_at: at,
    rrule: "FREQ=WEEKLY", exdates: JSON.stringify(["2026-11-09T14:00:00.000Z"]), provider: "google", external_calendar_id: "primary", external_id: "s", etag: '"a"', ext_synced_at: at } }]]);
  const f = (async (url: string) => String(url).includes("oauth2") ? Response.json({ access_token: "at" })
    : Response.json({ nextSyncToken: "t2", items: [{ id: "s", etag: '"b"', summary: "New", start: { dateTime: "2026-11-02T14:00:00Z" }, end: { dateTime: "2026-11-02T15:00:00Z" }, recurrence: ["RRULE:FREQ=WEEKLY"] }] })) as typeof fetch;
  const acct = { id: "a", user_id: "u", provider: "google" as const, email: null, write_calendar_id: null, calendars: [{ id: "primary", name: "Me", color: null, primary: true, canEdit: true, sync: true }],
    cursors: { primary: { c: "t1", at: "2026-11-15T00:00:00.000Z" } }, connected_at: "2026-11-01T00:00:00.000Z", last_sync: null, error: null };
  // deno-lint-ignore no-explicit-any
  await syncAccount({ db: fakeDb(rows, await seal(env.CALENDAR_TOKEN_KEY, "r", "a"), { updates: [] }) as any, env, f, now: Date.parse("2026-11-17T12:00:00Z") }, acct);
  const data = rows.get("series")!.data;
  assertEquals(data.title, "New"); // the master really was re-applied
  assert(String(data.exdates).includes("2026-11-09T14:00:00.000Z"));
});

Deno.test("an Outlook create carries the Momentum id as its transactionId", async () => {
  const { syncAccount } = await import("./app.ts");
  const { rows } = unlinked();
  let sent: Record<string, unknown> | null = null;
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("login.microsoftonline")) return Response.json({ access_token: "at" });
    if (init?.method === "POST") {
      sent = JSON.parse(String(init.body));
      return Response.json({ id: "o1", "@odata.etag": "e1" });
    }
    return Response.json({ value: [] });
  }) as typeof fetch;
  const acct = { id: "a", user_id: "u", provider: "microsoft" as const, email: null, write_calendar_id: "cal", calendars: [{ id: "cal", name: "C", color: null, primary: false, canEdit: true, sync: true }],
    cursors: {}, connected_at: "2026-11-01T00:00:00.000Z", last_sync: null, error: null };
  // deno-lint-ignore no-explicit-any
  await syncAccount({ db: fakeDb(rows, await seal(env.CALENDAR_TOKEN_KEY, "r", "a"), { updates: [] }) as any, env, f, now: Date.parse("2026-11-17T12:00:00Z") }, acct);
  assertEquals((sent as Record<string, unknown> | null)?.transactionId, "new-local");
  assertEquals(rows.get("new-local")!.data.external_id, "o1");
});

Deno.test("the account update lands without a lock, and a lock is released only by its own lease", async () => {
  const { syncAccount } = await import("./app.ts");
  const run = async (lock: { data: string | null; error: { code: string } | null }) => {
    const { acct, rows } = unlinked();
    const log = { updates: [] as Record<string, unknown>[] };
    const base = fakeDb(rows, await seal(env.CALENDAR_TOKEN_KEY, "refresh", "acct-1"), log);
    const eqs: unknown[][] = [];
    const db = { ...base, rpc: (fn: string, a: never) => (fn === "calendar_try_lock" ? Promise.resolve(lock) : base.rpc(fn, a)),
      from: (t: string) => { const q = base.from(t); q.eq = ((...a: unknown[]) => (eqs.push(a), q)) as typeof q.eq; return q; } };
    // deno-lint-ignore no-explicit-any
    await syncAccount({ db: db as any, env, f: fakeGoogle().f, now: Date.parse("2026-11-17T12:00:00Z") }, acct);
    return { log, eqs };
  };
  const none = await run({ data: null, error: { code: "PGRST202" } }); // migration not applied
  assert(none.log.updates.some((u) => "cursors" in u && !("sync_until" in u)));
  assert(!none.log.updates.some((u) => "sync_until" in u));
  const mine = await run({ data: "lease-1", error: null });
  assert(mine.log.updates.some((u) => u.sync_until === null));
  assert(mine.eqs.some((a) => a[0] === "sync_until" && a[1] === "lease-1")); // released only if it is still ours
});
