/*
 * Sync engine (v1.1, PLAN D225): push the outbox, pull what changed, apply it, refresh the stores.
 * Pure rules live in domain/sync.ts; this file is the I/O around them. Main window only.
 */
import type Database from "@tauri-apps/plugin-sql";
import { create } from "zustand";
import { onWrite, select, transact } from "../../db/client";
import { saveSettings } from "../../db/settings";
import { snapshotDatabase } from "../../db/backup";
import { USER_SETTING_KEYS, withRemoteSettings } from "../../domain/settings";
import { isSyncTarget, pendingFields, planApply, pushBatches, SYNC_TABLES, tagWinner, type ApplyOp, type OutboxRow, type RemoteRow, type SyncTable } from "../../domain/sync";
import { hydrate } from "../../stores/data";
import { hydrateFocus } from "../../stores/focus";
import { hydrateHabits } from "../../stores/habits";
import { hydrateProgress } from "../../stores/progress";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/ui";
import { restoreSession, supabase, syncConfigured } from "./supabase";

/** The local schema this client speaks (latest migration); the server refuses older clients (spec, "Version skew"). */
const CLIENT_SCHEMA = 9;
const PAGE = 1000;

export type SyncStatus =
  | { kind: "off" }
  | { kind: "idle"; at: string | null }
  | { kind: "syncing" }
  | { kind: "offline" }
  | { kind: "error"; message: string }
  | { kind: "updateRequired" };
export type SyncIssue = { at: string; tbl: string; id: string; reason: string };

export const useSync = create<{ status: SyncStatus; account: string | null; issues: SyncIssue[] }>(() => ({ status: { kind: "off" }, account: null, issues: [] }));

// ---------- local sync state ----------

async function state(key: string): Promise<string | null> {
  const rows = await select<{ value: string }>("SELECT value FROM sync_state WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}
const setState = (d: Database, key: string, value: string) =>
  d.execute("INSERT INTO sync_state (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);

/** This device's id in the account's device list. */
export async function deviceId(): Promise<string> {
  const have = await state("device_id");
  if (have) return have;
  const id = crypto.randomUUID();
  await transact((d) => setState(d, "device_id", id));
  return id;
}

async function addIssues(found: SyncIssue[]) {
  if (!found.length) return;
  const issues = [...found, ...useSync.getState().issues].slice(0, 50);
  useSync.setState({ issues });
  await transact((d) => setState(d, "issues", JSON.stringify(issues)));
}

// ---------- push ----------

type PushResult = { last_seq: number; refused: { seq: number; tbl: string; id: string; reason: string }[] } | { error: "update_required" };

/** Boundary check on the RPC response. */
function parsePush(v: unknown): PushResult | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r.error === "update_required") return { error: "update_required" };
  if (typeof r.last_seq !== "number" || !Array.isArray(r.refused)) return null;
  const refused = r.refused.filter(
    (x): x is { seq: number; tbl: string; id: string; reason: string } =>
      typeof x === "object" && x !== null && typeof x.seq === "number" && typeof x.reason === "string",
  );
  return { last_seq: r.last_seq, refused };
}

async function push(device: string): Promise<"ok" | "updateRequired"> {
  for (;;) {
    const rows = await select<OutboxRow>("SELECT seq, tbl, row_id, fields FROM sync_outbox ORDER BY seq LIMIT 5000");
    if (!rows.length) return "ok";
    for (const batch of pushBatches(rows)) {
      const patches = batch.map((r) => ({ seq: r.seq, tbl: r.tbl, id: r.row_id, fields: JSON.parse(r.fields) as unknown }));
      const { data, error } = await supabase.rpc("sync_push", { p_device: device, p_schema: CLIENT_SCHEMA, p_patches: patches });
      if (error) throw error;
      const res = parsePush(data);
      if (!res) throw new Error("Unexpected reply from the sync server");
      if ("error" in res) return "updateRequired";
      await transact((d) => d.execute("DELETE FROM sync_outbox WHERE seq <= $1", [res.last_seq]));
      const at = new Date().toISOString();
      await addIssues(res.refused.map((x) => ({ at, tbl: String(x.tbl), id: String(x.id), reason: x.reason })));
    }
    if (rows.length < 5000) return "ok";
  }
}

// ---------- pull ----------

function parseRemote(v: unknown): RemoteRow[] | null {
  if (!Array.isArray(v)) return null;
  const out: RemoteRow[] = [];
  for (const x of v) {
    if (typeof x !== "object" || x === null) return null;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.version !== "number" || typeof r.data !== "object" || r.data === null || Array.isArray(r.data)) return null;
    if (!isSyncTarget(r.tbl)) continue; // a table a newer client added: not ours to apply
    out.push({ tbl: r.tbl, id: r.id, data: r.data as Record<string, unknown>, version: r.version });
  }
  return out;
}

async function columnsOf(d: Database): Promise<Record<SyncTable, string[]>> {
  const entries = await Promise.all(
    (Object.keys(SYNC_TABLES) as SyncTable[]).map(async (t) => [t, (await d.select<{ name: string }[]>(`PRAGMA table_info(${t})`)).map((c) => c.name)] as const),
  );
  return Object.fromEntries(entries) as Record<SyncTable, string[]>;
}

const where = (key: Record<string, unknown>, from = 1) => Object.keys(key).map((c, i) => `${c} = $${i + from}`).join(" AND ");

/** Applies one op; returns an issue instead of throwing, so one bad row never blocks the rest. */
async function applyOp(d: Database, op: Exclude<ApplyOp, { kind: "settings" }>): Promise<string | null> {
  try {
    if (op.kind === "delete") {
      await d.execute(`DELETE FROM ${op.tbl} WHERE ${where(op.key)}`, Object.values(op.key));
      return null;
    }
    const key = SYNC_TABLES[op.tbl];
    const cols = Object.keys(op.row);
    const rest = cols.filter((c) => !(key as readonly string[]).includes(c));
    const sql =
      `INSERT INTO ${op.tbl} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ` +
      `ON CONFLICT(${key.join(", ")}) DO ${rest.length ? `UPDATE SET ${rest.map((c) => `${c} = excluded.${c}`).join(", ")}` : "NOTHING"}`;
    try {
      await d.execute(sql, Object.values(op.row));
    } catch (err) {
      if (op.tbl !== "tags" || !/UNIQUE/i.test(String(err))) throw err;
      // Same tag name made on two devices: both keep the smaller id and tombstone the other (D225).
      const [mine] = await d.select<{ id: string }[]>("SELECT id FROM tags WHERE name = $1 COLLATE NOCASE", [op.row.name]);
      if (!mine) throw err;
      const loser = tagWinner(mine.id, op.id) === mine.id ? op.id : mine.id;
      await d.execute(
        "INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('tags', $1, json_object('deleted_at', $2), $2)",
        [loser, new Date().toISOString()],
      );
      if (loser === mine.id) {
        await d.execute("DELETE FROM tags WHERE id = $1", [mine.id]);
        await d.execute(sql, Object.values(op.row));
      }
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function pull(): Promise<boolean> {
  let cursor = Number((await state("cursor")) ?? 0);
  const remote: RemoteRow[] = [];
  for (;;) {
    const { data, error } = await supabase.rpc("sync_pull", { p_cursor: cursor, p_limit: PAGE });
    if (error) throw error;
    const page = parseRemote(data);
    if (!page) throw new Error("Unexpected reply from the sync server");
    remote.push(...page);
    const rows = data as { version: number }[];
    const last = rows[rows.length - 1];
    if (last) cursor = last.version;
    if ((data as unknown[]).length < PAGE) break;
  }
  if (!remote.length) return false;

  const at = new Date().toISOString();
  const { settings, issues } = await transact(async (d) => {
    const outbox = await d.select<OutboxRow[]>("SELECT seq, tbl, row_id, fields FROM sync_outbox");
    const ops = planApply(remote, pendingFields(outbox), await columnsOf(d));
    const issues: SyncIssue[] = [];
    let settings: Record<string, unknown> | null = null;
    // The triggers must not send other devices' changes back to the server.
    await setState(d, "record", "0");
    try {
      for (const op of ops) {
        if (op.kind === "settings") {
          settings = op.fields;
          continue;
        }
        const reason = await applyOp(d, op);
        if (reason) issues.push({ at, tbl: op.tbl, id: op.id, reason });
      }
    } finally {
      await setState(d, "record", "1");
    }
    await setState(d, "cursor", String(cursor));
    return { settings, issues };
  });
  await addIssues(issues);
  if (settings) {
    const next = withRemoteSettings(useSettings.getState().settings, settings);
    useSettings.setState({ settings: next });
    await saveSettings(next, false);
  }
  await Promise.all([hydrate(false), hydrateHabits(), hydrateFocus(), hydrateProgress()]);
  return true;
}

// ---------- scheduling ----------

let running: Promise<void> | null = null;
let again = false;

/** Push then pull. Overlapping calls coalesce into one follow-up run. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runOnce();
    } while (again);
  })().finally(() => (running = null));
  return running;
}

async function runOnce() {
  if (!useSync.getState().account) return;
  if (!navigator.onLine) return useSync.setState({ status: { kind: "offline" } });
  if (!(await supabase.auth.getSession()).data.session) {
    const restored = await restoreSession();
    if (restored === "offline") return useSync.setState({ status: { kind: "offline" } });
    if (restored === "ended") {
      // The server ended this session (signed out everywhere, revoked): keep the data, ask to sign in again.
      await signOut("keep");
      return toast("You were signed out. Your data is still on this device; sign in again to keep syncing.");
    }
  }
  useSync.setState({ status: { kind: "syncing" } });
  try {
    if ((await push(await deviceId())) === "updateRequired") return useSync.setState({ status: { kind: "updateRequired" } });
    await pull();
    useSync.setState({ status: { kind: "idle", at: new Date().toISOString() } });
  } catch (err) {
    // An access token the server no longer accepts: drop it, and the next run re-checks the session.
    if (typeof err === "object" && err !== null && "code" in err && (err.code === "PGRST301" || err.code === "PGRST303")) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      again = true;
      return;
    }
    console.error("Sync failed", err);
    useSync.setState({ status: navigator.onLine ? { kind: "error", message: err instanceof Error ? err.message : String(err) } : { kind: "offline" } });
  }
}

let stop: (() => void) | null = null;

/** Starts the triggers for sync: local writes (debounced 2 s), Realtime pings, every 5 min, back online. */
function schedule(account: string, device: string) {
  stop?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offWrite = onWrite(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 2000);
  });
  const every = setInterval(() => void syncNow(), 5 * 60_000);
  const online = () => void syncNow();
  window.addEventListener("online", online);
  const channel = supabase
    .channel(`devices:${account}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "devices", filter: `owner_id=eq.${account}` }, (p) => {
      const row = p.new as { id?: string } | undefined;
      if (row?.id !== device) void syncNow();
    })
    .subscribe();
  stop = () => {
    clearTimeout(timer);
    offWrite();
    clearInterval(every);
    window.removeEventListener("online", online);
    void supabase.removeChannel(channel);
  };
}

/** At launch: resumes sync if this device was signed in. */
export async function startSync() {
  if (!syncConfigured) return;
  const account = await state("account");
  const raw = await state("issues");
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) useSync.setState({ issues: parsed as SyncIssue[] });
  } catch {
    /* a bad issues list only loses the history */
  }
  if (!account) return;
  useSync.setState({ account, status: { kind: "idle", at: null } });
  schedule(account, await deviceId());
  void syncNow();
}

// ---------- signing in and out ----------

export type FirstSync = { counts: Partial<Record<SyncTable, number>> };

/** Which data situation signing in to `account` meets on this device. */
export async function signInSituation(account: string): Promise<"resume" | "fresh" | "otherAccount"> {
  if ((await state("account")) === account || (await state("former_account")) === account) return "resume";
  const former = await state("former_account");
  return former && former !== account ? "otherAccount" : "fresh";
}

/**
 * Turns sync on for `account` (D118). `fresh`: back up, queue every local row as a create
 * (rerunning this is safe: the queue is rebuilt, creates are upserts), then sync.
 * `resume`: the same account again, carry on from the cursor.
 */
export async function enableSync(account: string, mode: "fresh" | "resume"): Promise<FirstSync> {
  const counts: FirstSync["counts"] = {};
  if (mode === "fresh") {
    await snapshotDatabase("before-sign-in");
    await transact(async (d) => {
      await d.execute("DELETE FROM sync_outbox");
      await d.execute("DELETE FROM sync_state WHERE key IN ('cursor', 'former_account')");
      const cols = await columnsOf(d);
      const at = new Date().toISOString();
      for (const t of Object.keys(SYNC_TABLES) as SyncTable[]) {
        const pairs = cols[t].flatMap((c) => [`'${t === "habit_checkins" && c === "value" ? "_delta" : c}'`, c]);
        if (!cols[t].includes("deleted_at")) pairs.push("'deleted_at'", "NULL");
        const rowId = t === "habit_checkins" ? "habit_id || '|' || date" : SYNC_TABLES[t][0];
        const res = await d.execute(
          `INSERT INTO sync_outbox (tbl, row_id, fields, created_at) SELECT '${t}', ${rowId}, json_object(${pairs.join(", ")}), $1 FROM ${t}`,
          [at],
        );
        if (res.rowsAffected) counts[t] = res.rowsAffected;
      }
      const s = useSettings.getState().settings;
      const user = Object.fromEntries(USER_SETTING_KEYS.map((k) => [k, s[k]]));
      await d.execute("INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('settings', 'user', $1, $2)", [JSON.stringify(user), at]);
      await setState(d, "account", account);
      await setState(d, "record", "1");
    });
  } else {
    await transact(async (d) => {
      await d.execute("DELETE FROM sync_state WHERE key = 'former_account'");
      await setState(d, "account", account);
      await setState(d, "record", "1");
    });
  }
  useSync.setState({ account, status: { kind: "idle", at: null } });
  const device = await deviceId();
  schedule(account, device);
  await syncNow();
  // The first push created this device's row; name its platform for the device list.
  const ua = navigator.userAgent;
  const platform = /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : /Windows/.test(ua) ? "Windows" : null;
  if (platform) await supabase.from("devices").update({ platform }).eq("id", device).eq("owner_id", account);
  return { counts };
}

/**
 * `keep`: the data stays and keeps being recorded, so signing back in to the same account
 * pushes what changed meanwhile (D119). `remove`: snapshot, then delete every synced row.
 */
export async function signOut(how: "keep" | "remove", everywhere = false) {
  stop?.();
  stop = null;
  const account = useSync.getState().account;
  if (how === "keep" && account)
    await transact(async (d) => {
      await d.execute("DELETE FROM sync_state WHERE key IN ('account', 'cursor')");
      await setState(d, "former_account", account);
    });
  else await wipeLocal();
  await supabase.auth.signOut({ scope: everywhere ? "global" : "local" }).catch((e) => console.error("Sign-out request failed", e));
  useSync.setState({ account: null, status: { kind: "off" } });
}

/** Deletes every synced row and the sync state (after a snapshot), leaving an empty inbox. */
export async function wipeLocal() {
  await snapshotDatabase("before-remove");
  await transact(async (d) => {
    await setState(d, "record", "0");
    await d.execute("DELETE FROM sync_outbox");
    await d.execute("DELETE FROM sync_state WHERE key IN ('account', 'cursor', 'former_account')");
    for (const t of (Object.keys(SYNC_TABLES) as SyncTable[]).reverse()) await d.execute(`DELETE FROM ${t}`);
    await d.execute("INSERT INTO lists (id, name, sort_order) VALUES ('inbox', 'Inbox', -1)");
  });
  await Promise.all([hydrate(false), hydrateHabits(), hydrateFocus(), hydrateProgress()]);
}
