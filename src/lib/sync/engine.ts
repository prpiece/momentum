/*
 * Sync engine (v1.1, PLAN D225): push the outbox, pull what changed, apply it, refresh the stores.
 * Pure rules live in domain/sync.ts; this file is the I/O around them. Main window only.
 */
import { create } from "zustand";
import { onWrite, select, transact, write, type Driver } from "../../db/client";
import { saveSettings } from "../../db/settings";
import { USER_SETTING_KEYS, withRemoteSettings } from "../../domain/settings";
import { isSyncTarget, pendingFields, planApply, pushBatches, SYNC_TABLES, tagWinner, type ApplyOp, type OutboxRow, type RemoteRow, type SyncTable } from "../../domain/sync";
import { INBOX_ID } from "../../domain/types";
import { hydrate } from "../../stores/data";
import { hydrateFocus } from "../../stores/focus";
import { hydrateHabits } from "../../stores/habits";
import { hydrateSubscriptions } from "../../stores/subscriptions";
import { useSettings } from "../../stores/settings";
import { toast } from "../../stores/toast";
import { restoreSession, supabase, syncConfigured } from "./supabase";

/** The local schema this client speaks (latest migration); the server refuses older clients (spec, "Version skew"). */
export const CLIENT_SCHEMA = 10;
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

export async function state(key: string): Promise<string | null> {
  const rows = await select<{ value: string }>("SELECT value FROM sync_state WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}
/** Copies the database aside before sign-in replaces or removes data. Each app plugs in its own (it knows where backups go). */
let snapshotDatabase: (reason: string) => Promise<unknown> = async () => undefined;
export const setSnapshot = (fn: typeof snapshotDatabase) => void (snapshotDatabase = fn);

const setState = (d: Driver, key: string, value: string) =>
  d.execute("INSERT INTO sync_state (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);

export const setLocalState = (key: string, value: string) =>
  write(["INSERT INTO sync_state (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]]);

/** This device's id in the account's device list. */
export async function deviceId(): Promise<string> {
  const have = await state("device_id");
  if (have) return have;
  const id = crypto.randomUUID();
  await transact((d) => setState(d, "device_id", id));
  return id;
}

/** Settings → Account → Sync issues → Clear: the list is history, not state to act on. */
export async function clearSyncIssues() {
  useSync.setState({ issues: [] });
  await transact((d) => setState(d, "issues", "[]"));
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
  pages: for (;;) {
    const rows = await select<OutboxRow>("SELECT seq, tbl, row_id, fields FROM sync_outbox ORDER BY seq LIMIT 5000");
    if (!rows.length) return "ok";
    // The highest seq this database ever made. The server can only be ahead of it when this file is a copy or a
    // restored backup that shares its device id with the original (SYNC-06).
    // ponytail: misses a copy that has since made more seqs than the original; an id kept outside the DB file covers that.
    const [made] = await select<{ seq: number }>("SELECT seq FROM sqlite_sequence WHERE name = 'sync_outbox'");
    for (const batch of pushBatches(rows)) {
      const patches = batch.map((r) => ({ seq: r.seq, tbl: r.tbl, id: r.row_id, fields: JSON.parse(r.fields) as unknown }));
      const { data, error } = await supabase.rpc("sync_push", { p_device: device, p_schema: CLIENT_SCHEMA, p_patches: patches });
      if (error) throw error;
      const res = parsePush(data);
      if (!res) throw new Error("Unexpected reply from the sync server");
      if ("error" in res) return "updateRequired";
      if (res.last_seq > (made?.seq ?? 0)) {
        // The server skipped these patches as seen before: push them again as a new device (field merges replay safely).
        device = crypto.randomUUID();
        await transact((d) => setState(d, "device_id", device));
        named = false;
        continue pages;
      }
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

async function columnsOf(d: Driver): Promise<Record<SyncTable, string[]>> {
  const entries = await Promise.all(
    (Object.keys(SYNC_TABLES) as SyncTable[]).map(async (t) => [t, (await d.select<{ name: string }[]>(`PRAGMA table_info(${t})`)).map((c) => c.name)] as const),
  );
  return Object.fromEntries(entries) as Record<SyncTable, string[]>;
}

const where = (key: Record<string, unknown>, from = 1) => Object.keys(key).map((c, i) => `${c} = $${i + from}`).join(" AND ");

type Upsert = Extract<ApplyOp, { kind: "upsert" }>;
const exists = async (d: Driver, tbl: string, id: unknown) => (await d.select<unknown[]>(`SELECT 1 FROM ${tbl} WHERE id = $1`, [id])).length > 0;

/**
 * A task record can name a list, parent or section this device never received (seen live: a list
 * whose create never reached the server). Rather than failing the foreign key on every sync, the
 * task goes to the Inbox and loses the missing parent or section. A record for a task that isn't
 * here and lacks what a task needs (a fragment of later edits) has nothing to build: skip it (null).
 */
async function resolveTaskRefs(d: Driver, op: Upsert): Promise<Upsert | null> {
  const row = { ...op.row };
  if (!(await exists(d, "tasks", op.id)) && (row.title == null || row.list_id == null)) {
    console.warn(`sync: skipped an incomplete record for task ${op.id}`);
    return null;
  }
  const missing: string[] = [];
  for (const [col, tbl, to] of [["list_id", "lists", INBOX_ID], ["parent_id", "tasks", null], ["section_id", "sections", null]] as const) {
    if (row[col] == null || (await exists(d, tbl, row[col]))) continue;
    missing.push(`${tbl}|${String(row[col])}`);
    row[col] = to;
  }
  // Remember what's missing: when it arrives, the next pull starts over so the task moves to it (SYNC-10).
  if (missing.length) await setState(d, "awaiting", JSON.stringify([...new Set([...(await awaiting(d)), ...missing])]));
  return { ...op, row };
}

/** Lists, tasks and sections that pulled tasks named before this device had them (`tbl|id`). */
async function awaiting(d: Driver): Promise<string[]> {
  const [r] = await d.select<{ value: string }[]>("SELECT value FROM sync_state WHERE key = 'awaiting'");
  try {
    const v: unknown = JSON.parse(r?.value ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Drops the awaited rows that are here now; true when any arrived. */
async function settleAwaiting(d: Driver): Promise<boolean> {
  const waiting = await awaiting(d);
  if (!waiting.length) return false;
  const left: string[] = [];
  for (const k of waiting) {
    const [tbl, id] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
    if ((tbl === "lists" || tbl === "tasks" || tbl === "sections") && !(await exists(d, tbl, id))) left.push(k);
  }
  if (left.length === waiting.length) return false;
  await setState(d, "awaiting", JSON.stringify(left));
  return true;
}

/**
 * A remote list or task delete would cascade away tasks here that the server has never seen (their create
 * is still in the outbox), and the push would then upload them alive (SYNC-07). Keep them, in the Inbox or
 * at the top level, and push that move, so every device ends up the same.
 */
async function keepUnpushedChildren(d: Driver, tbl: "lists" | "tasks", id: string) {
  const patch = tbl === "lists" ? { list_id: INBOX_ID, section_id: null } : { parent_id: null };
  const kids = await d.select<{ id: string }[]>(
    `SELECT id FROM tasks WHERE ${tbl === "lists" ? "list_id" : "parent_id"} = $1
       AND EXISTS (SELECT 1 FROM sync_outbox o WHERE o.tbl = 'tasks' AND o.row_id = tasks.id AND json_type(o.fields, '$.id') IS NOT NULL)`,
    [id],
  );
  for (const k of kids) {
    await d.execute(`UPDATE tasks SET ${Object.keys(patch).map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`, [k.id, ...Object.values(patch)]);
    await d.execute("INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('tasks', $1, $2, $3)", [k.id, JSON.stringify(patch), new Date().toISOString()]);
  }
}

/** Applies one op; returns an issue instead of throwing, so one bad row never blocks the rest. */
export async function applyOp(d: Driver, op: Exclude<ApplyOp, { kind: "settings" }>): Promise<string | null> {
  try {
    if (op.kind === "delete") {
      if (op.tbl === "lists" || op.tbl === "tasks") await keepUnpushedChildren(d, op.tbl, op.id);
      await d.execute(`DELETE FROM ${op.tbl} WHERE ${where(op.key)}`, Object.values(op.key));
      return null;
    }
    // A trashed record for a row this device doesn't have stays gone: it was purged here (a purge elsewhere
    // looks the same), and bringing it back would start another 30 days in the Trash.
    if (op.row.deleted_at != null && !(await exists(d, op.tbl, op.id))) return null;
    const up = op.tbl === "tasks" ? await resolveTaskRefs(d, op) : op;
    if (!up) return null;
    const key = SYNC_TABLES[up.tbl];
    const cols = Object.keys(up.row);
    const rest = cols.filter((c) => !(key as readonly string[]).includes(c));
    const p = (c: string) => `$${cols.indexOf(c) + 1}`;
    const match = key.map((c) => `${c} = ${p(c)}`).join(" AND ");
    // Fields with pending local edits are left out of the row, so it can lack NOT NULL columns
    // (updated_at, title). SQLite checks NOT NULL before ON CONFLICT, so an upsert would fail:
    // update the row in place, and insert only when there is none.
    const guards = [`NOT EXISTS (SELECT 1 FROM ${op.tbl} WHERE ${match})`];
    // Activity whose task is gone locally (purged, or tombstoned elsewhere) is skipped, not an error.
    if (op.tbl === "task_activity" && cols.includes("task_id")) guards.push(`EXISTS (SELECT 1 FROM tasks WHERE id = ${p("task_id")})`);
    const insert = `INSERT INTO ${op.tbl} (${cols.join(", ")}) SELECT ${cols.map(p).join(", ")} WHERE ${guards.join(" AND ")}`;
    const update = `UPDATE ${op.tbl} SET ${rest.map((c) => `${c} = ${p(c)}`).join(", ")} WHERE ${match}`;
    const run = async () => {
      if (rest.length) await d.execute(update, Object.values(up.row));
      await d.execute(insert, Object.values(up.row));
    };
    try {
      await run();
    } catch (err) {
      if (op.tbl !== "tags" || !/UNIQUE/i.test(String(err))) throw err;
      // Same tag name made on two devices: both keep the smaller id and tombstone the other (D225).
      const [mine] = await d.select<{ id: string }[]>("SELECT id FROM tags WHERE name = $1 COLLATE NOCASE", [up.row.name]);
      if (!mine) throw err;
      const winner = tagWinner(mine.id, op.id);
      const loser = winner === mine.id ? op.id : mine.id;
      const now = new Date().toISOString();
      await d.execute("INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('tags', $1, json_object('deleted_at', $2), $2)", [loser, now]);
      // Tasks hold tag ids: move this device's tasks to the winner and push that, so no device loses the tag.
      const tagged = await d.select<{ id: string; tags: string }[]>(
        "SELECT id, tags FROM tasks WHERE EXISTS (SELECT 1 FROM json_each(tasks.tags) WHERE value = $1)",
        [loser],
      );
      for (const t of tagged) {
        const had: unknown = JSON.parse(t.tags);
        const tags = JSON.stringify([...new Set((Array.isArray(had) ? had : []).map((x) => (x === loser ? winner : x)))]);
        await d.execute("UPDATE tasks SET tags = $1 WHERE id = $2", [tags, t.id]);
        await d.execute("INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('tasks', $1, json_object('tags', $2), $3)", [t.id, tags, now]);
      }
      if (loser === mine.id) {
        await d.execute("DELETE FROM tags WHERE id = $1", [mine.id]);
        await run();
      }
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Pulls what the server has changed and applies it; returns the rows it received. */
async function pull(): Promise<RemoteRow[]> {
  const started = session;
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
  if (!remote.length) return [];

  const at = new Date().toISOString();
  // A settings change still waiting on its debounce goes into the outbox first, so it wins like any pending edit.
  await useSettings.getState().flush();
  const applied = await transact(async (d) => {
    // Signed out while this pull was on the wire: the old account's rows must not land (SYNC-04).
    if (session !== started) return null;
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
    // ponytail: a whole re-pull when an awaited list or parent arrives; rare. Re-request by id if it gets costly.
    if (await settleAwaiting(d)) {
      cursor = 0;
      again = true;
    }
    await setState(d, "cursor", String(cursor));
    await setState(d, "cursor_schema", String(CLIENT_SCHEMA));
    return { settings, issues };
  });
  if (!applied) return [];
  const { settings, issues } = applied;
  await addIssues(issues);
  if (settings) {
    const next = withRemoteSettings(useSettings.getState().settings, settings);
    useSettings.setState({ settings: next });
    await saveSettings(next, false);
  }
  await Promise.all([hydrate(false), hydrateHabits(), hydrateFocus(), hydrateSubscriptions(false)]);
  return remote;
}

// ---------- scheduling ----------

let running: Promise<void> | null = null;
let again = false;
/** Bumped by signOut: a run that started before it writes nothing more (SYNC-04). */
let session = 0;

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

/**
 * What sync needs from the app it runs in (PLAN D229): the platform name for the device list,
 * whether the network is up, and when to sync again (back online; on the phone, back in front).
 */
export type SyncHost = { platform: string | null; online(): boolean; watch(sync: () => void): () => void };
let host: SyncHost = { platform: null, online: () => true, watch: () => () => undefined };
export const setSyncHost = (h: SyncHost) => void (host = h);

let named = false;
/**
 * Names this device's platform for the device list, once per launch. The row only exists after
 * a push that carried patches, so this retries on later runs until the update finds it.
 */
async function namePlatform(device: string): Promise<boolean> {
  const { platform } = host;
  if (!platform) return true;
  const { data, error } = await supabase.from("devices").update({ platform }).eq("id", device).select("id");
  return !error && !!data?.length;
}

/** PostgREST's "JWT expired" codes. */
export const isExpiredJwt = (err: unknown) => typeof err === "object" && err !== null && "code" in err && (err.code === "PGRST301" || err.code === "PGRST303");

/** The server ended this session (signed out everywhere, revoked): keep the data, ask to sign in again. */
async function endedSession() {
  await signOut("keep");
  toast("You were signed out. Your data is still on this device; sign in again to keep syncing.");
}

async function runOnce() {
  if (!useSync.getState().account) return;
  if (!host.online()) return useSync.setState({ status: { kind: "offline" } });
  if (!(await supabase.auth.getSession()).data.session) {
    const restored = await restoreSession();
    if (restored === "offline") return useSync.setState({ status: { kind: "offline" } });
    if (restored === "ended") return endedSession();
  }
  useSync.setState({ status: { kind: "syncing" } });
  const started = session;
  try {
    // The server's floor, read even with nothing to push, so an idle client still learns it's too old.
    const { data: meta } = await supabase.from("server_meta").select("min_client_schema").maybeSingle();
    const tooOld = typeof meta?.min_client_schema === "number" && meta.min_client_schema > CLIENT_SCHEMA;
    if (tooOld || (await push(await deviceId())) === "updateRequired") return useSync.setState({ status: { kind: "updateRequired" } });
    await pull();
    if (session !== started) return; // signed out meanwhile
    if (!named) named = await namePlatform(await deviceId()); // push may have taken a new id
    useSync.setState({ status: { kind: "idle", at: new Date().toISOString() } });
  } catch (err) {
    // An access token the server no longer accepts: refresh the session from the stored refresh token. Only a
    // refresh the server refuses ends sign-in; a plain sign-out here would delete that token (H14).
    if (isExpiredJwt(err)) {
      const restored = await restoreSession();
      if (restored === "ok") return void (again = true);
      if (restored === "ended") return endedSession();
      return useSync.setState({ status: { kind: "offline" } });
    }
    console.error("Sync failed", err);
    useSync.setState({ status: host.online() ? { kind: "error", message: err instanceof Error ? err.message : String(err) } : { kind: "offline" } });
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
  const unwatch = host.watch(() => void syncNow());
  const channel = supabase
    .channel(`devices:${account}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "devices", filter: `owner_id=eq.${account}` }, (p) => {
      // A sibling device pushed. Not this device's own echo, and not a DELETE: those reach every user, unfiltered (SYNC-15).
      const row = p.new as { id?: string } | undefined;
      if (row?.id && row.id !== device) void syncNow();
    })
    // Server-side changes for this account (a share member's push, a sent task, a bot), the only device included (SYNC-09).
    .on("postgres_changes", { event: "*", schema: "public", table: "sync_pings", filter: `account_id=eq.${account}` }, () => void syncNow())
    .subscribe();
  stop = () => {
    clearTimeout(timer);
    offWrite();
    clearInterval(every);
    unwatch();
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
    if (Array.isArray(parsed)) {
      const old = parsed as SyncIssue[];
      // Rows with pending local edits used to fail NOT NULL (D251). They apply now: pull everything again once
      // to recover the changes those failures dropped (pending local fields still win), and drop the reports.
      const notNull = (i: SyncIssue) => /NOT NULL constraint failed/.test(i.reason);
      // Tasks naming a list, parent or section that never arrived apply now too (to the Inbox, v1.2.2).
      const taskRefs = (i: SyncIssue) => i.tbl === "tasks" && /FOREIGN KEY constraint failed/.test(i.reason);
      if (old.some((i) => notNull(i) || taskRefs(i))) await setLocalState("cursor", "0");
      // Orphaned activity rows used to be reported as foreign-key issues; they're skipped now, so drop the old reports.
      const fixed = (i: SyncIssue) => notNull(i) || taskRefs(i) || (i.tbl === "task_activity" && /FOREIGN KEY constraint failed/.test(i.reason));
      const weekAgo = Date.now() - 7 * 86_400_000;
      const issues = old.filter((i) => !fixed(i) && Date.parse(i.at) > weekAgo);
      useSync.setState({ issues });
      if (issues.length < old.length) await setLocalState("issues", JSON.stringify(issues));
    }
  } catch {
    /* a bad issues list only loses the history */
  }
  if (!account) return;
  // A pull the app died in leaves recording off: turn it back on, or local edits stop syncing (SYNC-02).
  await setLocalState("record", "1");
  // The cursor was built by an older schema, which dropped the columns and tables it didn't have: pull everything
  // again once so they arrive (SYNC-05). Pending local fields still win.
  if ((await state("cursor_schema")) !== String(CLIENT_SCHEMA)) {
    await setLocalState("cursor", "0");
    await setLocalState("cursor_schema", String(CLIENT_SCHEMA));
  }
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
 * Queues every local row as a create, except those the server already sent (`skip`): a second device must
 * not push its default Inbox over the server's copy (H15). Returns the row counts.
 */
export async function queueLocalRows(d: Driver, skip: readonly RemoteRow[], at: string): Promise<Partial<Record<SyncTable, number>>> {
  const counts: Partial<Record<SyncTable, number>> = {};
  const cols = await columnsOf(d);
  for (const t of Object.keys(SYNC_TABLES) as SyncTable[]) {
    const pairs = cols[t].flatMap((c) => [`'${t === "habit_checkins" && c === "value" ? "_delta" : c}'`, c]);
    if (!cols[t].includes("deleted_at")) pairs.push("'deleted_at'", "NULL");
    const rowId = t === "habit_checkins" ? "habit_id || '|' || date" : SYNC_TABLES[t][0];
    const have = JSON.stringify(skip.filter((r) => r.tbl === t).map((r) => r.id));
    const res = await d.execute(
      `INSERT INTO sync_outbox (tbl, row_id, fields, created_at) SELECT '${t}', ${rowId}, json_object(${pairs.join(", ")}), $1 FROM ${t} WHERE (${rowId}) NOT IN (SELECT value FROM json_each($2))`,
      [at, have],
    );
    if (res.rowsAffected) counts[t] = res.rowsAffected;
  }
  return counts;
}

/**
 * Turns sync on for `account` (D118). `fresh`: back up, pull what the server has, then queue the local rows it
 * doesn't (rerunning this is safe: the queue is rebuilt, creates are upserts), then sync.
 * `resume`: the same account again, carry on from the cursor.
 */
export async function enableSync(account: string, mode: "fresh" | "resume"): Promise<FirstSync> {
  let counts: FirstSync["counts"] = {};
  if (mode === "fresh") {
    await snapshotDatabase("before-sign-in");
    await transact(async (d) => {
      await d.execute("DELETE FROM sync_outbox");
      await d.execute("DELETE FROM sync_state WHERE key IN ('cursor', 'former_account')");
    });
    // Pull first: the server's rows land here, and only what it lacks gets queued.
    const theirs = await pull();
    await transact(async (d) => {
      const at = new Date().toISOString();
      counts = await queueLocalRows(d, theirs, at);
      if (!theirs.some((r) => r.tbl === "settings")) {
        const s = useSettings.getState().settings;
        const user = Object.fromEntries(USER_SETTING_KEYS.map((k) => [k, s[k]]));
        await d.execute("INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('settings', 'user', $1, $2)", [JSON.stringify(user), at]);
      }
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
  return { counts };
}

/**
 * `keep`: the data stays and keeps being recorded, so signing back in to the same account
 * pushes what changed meanwhile (D119). `remove`: snapshot, then delete every synced row.
 */
export async function signOut(how: "keep" | "remove", everywhere = false) {
  session++;
  stop?.();
  stop = null;
  named = false;
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
  await Promise.all([hydrate(false), hydrateHabits(), hydrateFocus(), hydrateSubscriptions(false)]);
}
