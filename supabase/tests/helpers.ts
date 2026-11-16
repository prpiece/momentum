/*
 * Shared setup for the server tests against a local Supabase (`supabase start`).
 * Reads the local server's URL and keys from `supabase status`, so it can only ever reach the local stack.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export const status = Object.fromEntries(
  (process.env.SUPABASE_STATUS_ENV ?? execSync("supabase status -o env", { encoding: "utf8" }))
    .split(/\r?\n/)
    .map((l) => /^(\w+)="?([^"]*)"?$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [m[1], m[2]]),
);
export const URL = status.API_URL;
export const ANON = status.PUBLISHABLE_KEY;
export const SECRET = status.SECRET_KEY;
if (!URL?.startsWith("http://127.0.0.1")) throw new Error("Run `supabase start` first; these tests only run against the local stack.");
export const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin = () => createClient(URL, SECRET, opts);

export type User = { db: SupabaseClient; id: string; handle: string; token: string };

/** A fresh signed-in account with a profile (`handle` unless `profile` is false). */
export async function user(profile = true): Promise<User> {
  const email = `t-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(URL, ANON, opts);
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const id = data.user.id;
  const handle = `u${id.replace(/-/g, "").slice(0, 12)}`;
  if (profile) {
    const p = await db.from("profiles").insert({ id, handle, display_name: handle });
    if (p.error) throw p.error;
  }
  return { db, id, handle, token: signIn.data.session!.access_token };
}

export type Patch = { seq: number; tbl: string; id: string; fields: Record<string, unknown>; ts?: string | Record<string, string> };
export type PushResult = { last_seq?: number; refused?: { seq: number; tbl: string; id: string; reason: string }[]; error?: string };

const seqs = new WeakMap<SupabaseClient, number>();
const devices = new WeakMap<SupabaseClient, string>();

export async function push(db: SupabaseClient, device: string, patches: Patch[], schema = 9): Promise<PushResult> {
  const { data, error } = await db.rpc("sync_push", { p_device: device, p_schema: schema, p_patches: patches });
  if (error) throw error;
  return data as PushResult;
}

/** Pushes patches from the account's one test device, numbering them itself. */
export async function send(db: SupabaseClient, ...patches: { tbl: string; id: string; fields: Record<string, unknown> }[]) {
  if (!devices.has(db)) devices.set(db, randomUUID());
  let seq = seqs.get(db) ?? 0;
  const numbered = patches.map((p) => ({ ...p, seq: ++seq }));
  seqs.set(db, seq);
  return push(db, devices.get(db)!, numbered);
}

export type Remote = { tbl: string; id: string; data: Record<string, unknown>; version: number };

export async function pull(db: SupabaseClient, cursor = 0): Promise<Remote[]> {
  const out: Remote[] = [];
  for (;;) {
    const { data, error } = await db.rpc("sync_pull", { p_cursor: cursor });
    if (error) throw error;
    const page = data as Remote[];
    out.push(...page);
    if (page.length < 1000) return out;
    cursor = page.at(-1)!.version;
  }
}

/**
 * What a device that pulled everything from 0 would hold: the last version of each record wins,
 * merged field by field, and a tombstone removes it.
 */
export async function replica(db: SupabaseClient): Promise<Map<string, Record<string, unknown>>> {
  const m = new Map<string, Record<string, unknown>>();
  for (const r of await pull(db)) {
    const key = `${r.tbl}/${r.id}`;
    if (r.data.deleted_at) m.delete(key);
    else m.set(key, { ...(m.get(key) ?? {}), ...r.data });
  }
  return m;
}

export const row = async (db: SupabaseClient, tbl: string, id: string) => (await replica(db)).get(`${tbl}/${id}`);

export async function rpc<T = unknown>(db: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** The error message of a call expected to fail. */
export async function refusal(db: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<string> {
  const { error } = await db.rpc(fn, args);
  if (!error) throw new Error(`${fn} should have failed`);
  return error.message;
}

export const task = (id: string, list: string, extra: Record<string, unknown> = {}) => ({
  tbl: "tasks",
  id,
  fields: { id, title: id, list_id: list, status: "open", tags: "[]", reminders: "[]", pinned: 0, deleted_at: null, ...extra },
});
export const list = (id: string, folder: string | null = null, extra: Record<string, unknown> = {}) => ({
  tbl: "lists",
  id,
  fields: { id, name: id, folder_id: folder, sort_order: 0, pinned: 0, archived: 0, tint: 0, deleted_at: null, ...extra },
});
export const folder = (id: string, parent: string | null = null) => ({
  tbl: "folders",
  id,
  fields: { id, name: id, parent_id: parent, sort_order: 0, collapsed: 0, deleted_at: null },
});
export const uid = () => randomUUID();
