/*
 * Server sync and RLS against a local Supabase (`supabase start`). Run with `npm run test:server`.
 * Reads the local server's URL and keys from `supabase status`, so it can only ever reach the local stack.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const status = Object.fromEntries(
  execSync("supabase status -o env", { encoding: "utf8" })
    .split(/\r?\n/)
    .map((l) => /^(\w+)="?([^"]*)"?$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [m[1], m[2]]),
);
const URL = status.API_URL;
const ANON = status.PUBLISHABLE_KEY;
const SECRET = status.SECRET_KEY;
if (!URL?.startsWith("http://127.0.0.1")) throw new Error("Run `supabase start` first; these tests only run against the local stack.");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function user(): Promise<{ db: SupabaseClient; id: string }> {
  const admin = createClient(URL, SECRET, opts);
  const email = `t-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(URL, ANON, opts);
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, id: data.user.id };
}

type Patch = { seq: number; tbl: string; id: string; fields: Record<string, unknown> };
async function push(db: SupabaseClient, device: string, patches: Patch[], schema = 9) {
  const { data, error } = await db.rpc("sync_push", { p_device: device, p_schema: schema, p_patches: patches });
  if (error) throw error;
  return data as { last_seq?: number; refused?: { seq: number; reason: string }[]; error?: string };
}
async function pull(db: SupabaseClient, cursor = 0) {
  const { data, error } = await db.rpc("sync_pull", { p_cursor: cursor });
  if (error) throw error;
  return data as { tbl: string; id: string; data: Record<string, unknown>; version: number }[];
}
const row = async (db: SupabaseClient, tbl: string, id: string) => (await pull(db)).find((r) => r.tbl === tbl && r.id === id)?.data;

let a: { db: SupabaseClient; id: string };
let b: { db: SupabaseClient; id: string };
beforeAll(async () => {
  [a, b] = await Promise.all([user(), user()]);
});

describe("sync_push / sync_pull", () => {
  it("merges fields from two devices, last writer per field", async () => {
    const [d1, d2] = [randomUUID(), randomUUID()];
    await push(a.db, d1, [{ seq: 1, tbl: "lists", id: "l1", fields: { id: "l1", name: "Work", color: null, deleted_at: null } }]);
    await push(a.db, d2, [{ seq: 1, tbl: "lists", id: "l1", fields: { color: "#fff" } }]);
    await push(a.db, d1, [{ seq: 2, tbl: "lists", id: "l1", fields: { name: "Job" } }]);
    expect(await row(a.db, "lists", "l1")).toEqual({ id: "l1", name: "Job", color: "#fff", deleted_at: null });
  });

  it("never applies a patch twice when a push is retried", async () => {
    const d = randomUUID();
    const p = [{ seq: 1, tbl: "habit_checkins", id: "h|2026-01-01", fields: { habit_id: "h", date: "2026-01-01", _delta: 2, deleted_at: null } }];
    await push(a.db, d, p);
    const again = await push(a.db, d, p);
    expect(again.last_seq).toBe(1);
    expect((await row(a.db, "habit_checkins", "h|2026-01-01"))?.value).toBe(2);
  });

  it("adds check-in increments from two devices, and restarts from zero after a delete", async () => {
    const id = "h|2026-02-01";
    await push(a.db, randomUUID(), [{ seq: 1, tbl: "habit_checkins", id, fields: { habit_id: "h", date: "2026-02-01", _delta: 1, deleted_at: null } }]);
    await push(a.db, randomUUID(), [{ seq: 1, tbl: "habit_checkins", id, fields: { _delta: 2 } }]);
    expect((await row(a.db, "habit_checkins", id))?.value).toBe(3);
    const d = randomUUID();
    await push(a.db, d, [
      { seq: 1, tbl: "habit_checkins", id, fields: { deleted_at: "2026-02-02T00:00:00.000Z" } },
      { seq: 2, tbl: "habit_checkins", id, fields: { habit_id: "h", date: "2026-02-01", _delta: 1, deleted_at: null } },
    ]);
    expect((await row(a.db, "habit_checkins", id))?.value).toBe(1);
  });

  it("refuses a bad patch alone and applies the rest", async () => {
    const res = await push(a.db, randomUUID(), [
      { seq: 1, tbl: "not_a_table", id: "x", fields: {} },
      { seq: 2, tbl: "rest_days", id: "2026-03-01", fields: { date: "2026-03-01", deleted_at: null } },
    ]);
    expect(res.refused?.map((r) => r.seq)).toEqual([1]);
    expect(res.last_seq).toBe(2);
    expect(await row(a.db, "rest_days", "2026-03-01")).toBeTruthy();
  });

  it("pulls only what changed after the cursor, in version order", async () => {
    const all = await pull(a.db);
    const versions = all.map((r) => r.version);
    expect(versions).toEqual([...versions].sort((x, y) => x - y));
    const last = versions.at(-1)!;
    expect(await pull(a.db, last)).toEqual([]);
    await push(a.db, randomUUID(), [{ seq: 1, tbl: "tags", id: "t1", fields: { id: "t1", name: "x", deleted_at: null } }]);
    expect((await pull(a.db, last)).map((r) => r.id)).toEqual(["t1"]);
  });

  it("asks old clients to update", async () => {
    const admin = createClient(URL, SECRET, opts);
    await admin.from("server_meta").update({ min_client_schema: 10 }).eq("id", 1);
    try {
      expect((await push(a.db, randomUUID(), [], 9)).error).toBe("update_required");
    } finally {
      await admin.from("server_meta").update({ min_client_schema: 0 }).eq("id", 1);
    }
  });
});

describe("isolation between accounts", () => {
  it("never shows one account's records, devices or profile to another", async () => {
    await push(a.db, randomUUID(), [{ seq: 1, tbl: "tasks", id: "secret", fields: { id: "secret", title: "A's task", deleted_at: null } }]);
    await a.db.from("profiles").insert({ id: a.id, handle: `a${a.id.slice(0, 8)}`, display_name: "A" });
    expect((await pull(b.db)).find((r) => r.id === "secret")).toBeUndefined();
    expect((await b.db.from("sync_rows").select("*")).data).toEqual([]);
    expect((await b.db.from("devices").select("*")).data).toEqual([]);
    expect((await b.db.from("profiles").select("*").eq("id", a.id)).data).toEqual([]);
  });

  it("allows no direct writes to records and no profile for someone else", async () => {
    const direct = await b.db.from("sync_rows").insert({ owner_id: b.id, tbl: "tasks", id: "x", data: {}, version: 1 });
    expect(direct.error).not.toBeNull();
    const other = await b.db.from("profiles").insert({ id: a.id, handle: "hijack" });
    expect(other.error).not.toBeNull();
  });

  it("gives signed-out callers nothing", async () => {
    const anon = createClient(URL, ANON, opts);
    expect((await anon.rpc("sync_pull", { p_cursor: 0 })).error).not.toBeNull();
    expect((await anon.rpc("sync_push", { p_device: randomUUID(), p_schema: 9, p_patches: [] })).error).not.toBeNull();
  });
});

describe("profiles", () => {
  it("refuses reserved and malformed handles and a second change within 30 days", async () => {
    const { db, id } = await user();
    expect((await db.from("profiles").insert({ id, handle: "admin" })).error).not.toBeNull();
    expect((await db.from("profiles").insert({ id, handle: "No Caps" })).error).not.toBeNull();
    const first = `u${id.slice(0, 8)}`;
    expect((await db.from("profiles").insert({ id, handle: first, display_name: "U" })).error).toBeNull();
    const change = await db.from("profiles").update({ handle: `v${id.slice(0, 8)}` }).eq("id", id);
    expect(change.error?.message).toContain("handle_changed_recently");
  });
});
