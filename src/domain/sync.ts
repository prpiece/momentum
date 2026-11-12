/*
 * Pure sync rules (v1.1, PLAN D225). The device keeps an outbox of field patches written by
 * SQLite triggers; the server keeps one jsonb row per record and merges patches field by field.
 * This file decides what a pull may overwrite locally and in which order rows are applied.
 */

/** Synced tables in parent-before-child order, with the columns that name a row. */
export const SYNC_TABLES = {
  folders: ["id"],
  lists: ["id"],
  sections: ["id"],
  tags: ["id"],
  tasks: ["id"],
  task_activity: ["id"],
  calendar_events: ["id"],
  habit_groups: ["id"],
  habits: ["id"],
  habit_checkins: ["habit_id", "date"],
  focus_sessions: ["id"],
  rest_days: ["date"],
  celebrations: ["key"],
} as const;
export type SyncTable = keyof typeof SYNC_TABLES;
/** `settings`/`user` carries the user settings (domain/settings.ts USER_SETTING_KEYS). */
export type SyncTarget = SyncTable | "settings";

export const isSyncTarget = (t: unknown): t is SyncTarget => t === "settings" || (typeof t === "string" && t in SYNC_TABLES);

export type OutboxRow = { seq: number; tbl: string; row_id: string; fields: string };
/** A row as the server returns it: the merged record, tombstoned when `data.deleted_at` is set. */
export type RemoteRow = { tbl: SyncTarget; id: string; data: Record<string, unknown>; version: number };

export type ApplyOp =
  | { kind: "upsert"; tbl: SyncTable; id: string; row: Record<string, unknown> }
  | { kind: "delete"; tbl: SyncTable; id: string; key: Record<string, string> }
  | { kind: "settings"; fields: Record<string, unknown> };

const rowKey = (tbl: string, id: string) => `${tbl}\u0000${id}`;

/** Fields this device changed but hasn't pushed yet, per row. `_delta` stands for the check-in `value`. */
export function pendingFields(outbox: OutboxRow[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of outbox) {
    let fields: unknown;
    try {
      fields = JSON.parse(r.fields);
    } catch {
      continue;
    }
    if (typeof fields !== "object" || fields === null) continue;
    const set = out.get(rowKey(r.tbl, r.row_id)) ?? new Set<string>();
    for (const f of Object.keys(fields)) set.add(f === "_delta" ? "value" : f);
    out.set(rowKey(r.tbl, r.row_id), set);
  }
  return out;
}

/**
 * Turns pulled rows into local writes. Local edits that haven't been pushed win field by field:
 * the push that follows decides those fields on the server. A row with a pending delete or
 * re-create (`deleted_at` pending) is left alone entirely. Only known local columns are written.
 */
export function planApply(remote: RemoteRow[], pending: Map<string, Set<string>>, columns: Record<SyncTable, string[]>): ApplyOp[] {
  // The last version of a row wins when a page holds it twice.
  const latest = new Map<string, RemoteRow>();
  for (const r of remote) {
    const k = rowKey(r.tbl, r.id);
    const prev = latest.get(k);
    if (!prev || prev.version < r.version) latest.set(k, r);
  }
  const deletes: ApplyOp[] = [];
  const upserts: Extract<ApplyOp, { kind: "upsert" }>[] = [];
  const settings: Record<string, unknown> = {};
  // Tasks this batch removes or leaves alone: their activity rows would be orphans (the server doesn't cascade).
  const goneTasks = new Set<string>();
  for (const r of latest.values()) {
    const mine = pending.get(rowKey(r.tbl, r.id)) ?? new Set<string>();
    if (r.tbl === "tasks" && (mine.has("deleted_at") || r.data.deleted_at != null)) goneTasks.add(r.id);
    if (mine.has("deleted_at")) continue;
    const fields = Object.fromEntries(Object.entries(r.data).filter(([f]) => !mine.has(f)));
    if (r.tbl === "settings") {
      Object.assign(settings, fields);
      continue;
    }
    if (r.data.deleted_at != null) {
      deletes.push({ kind: "delete", tbl: r.tbl, id: r.id, key: keyFromId(r.tbl, r.id) });
      continue;
    }
    const cols = new Set(columns[r.tbl]);
    // Key columns always go in, so the upsert can find the row even when a key field is pending.
    const row = Object.fromEntries(Object.entries({ ...fields, ...keyFromId(r.tbl, r.id) }).filter(([c]) => cols.has(c)));
    upserts.push({ kind: "upsert", tbl: r.tbl, id: r.id, row });
  }
  const kept = upserts.filter((o) => !(o.tbl === "task_activity" && typeof o.row.task_id === "string" && goneTasks.has(o.row.task_id)));
  return [...deletes, ...orderUpserts(kept), ...(Object.keys(settings).length ? [{ kind: "settings" as const, fields: settings }] : [])];
}

/** The key columns a row id stands for: the id itself, or `habit_id|date` for check-ins (as the triggers build it). */
export function keyFromId(tbl: SyncTable, id: string): Record<string, string> {
  const cols = SYNC_TABLES[tbl];
  if (cols.length === 1) return { [cols[0]]: id };
  const cut = id.lastIndexOf("|");
  return { [cols[0]]: id.slice(0, cut), [cols[1]]: id.slice(cut + 1) };
}

const TABLE_ORDER = Object.keys(SYNC_TABLES) as SyncTable[];
/** Columns that point at a row of the same table, so parents go first. */
const SELF_REFS: Partial<Record<SyncTable, string[]>> = {
  folders: ["parent_id"],
  tasks: ["parent_id", "recurrence_parent_id"],
  calendar_events: ["recurrence_parent_id"],
};

/** Parents before children: by table, then by depth inside the batch for self-referencing tables. */
function orderUpserts<T extends { tbl: SyncTable; id: string; row: Record<string, unknown> }>(ops: T[]): T[] {
  const byId = new Map(ops.map((o) => [rowKey(o.tbl, o.id), o]));
  const depth = (o: T, n = 0): number => {
    if (n > 50) return n; // a cycle in bad data must not hang
    let d = 0;
    for (const c of SELF_REFS[o.tbl] ?? []) {
      const ref = o.row[c];
      const parent = typeof ref === "string" ? byId.get(rowKey(o.tbl, ref)) : undefined;
      if (parent && parent !== o) d = Math.max(d, depth(parent, n + 1) + 1);
    }
    return d;
  };
  return ops
    .map((o) => ({ o, t: TABLE_ORDER.indexOf(o.tbl), d: depth(o) }))
    .sort((a, b) => a.t - b.t || a.d - b.d)
    .map((x) => x.o);
}

/** Splits the outbox into push calls of at most `maxCount` patches and roughly `maxBytes` (spec: 500 and 1 MB). */
export function pushBatches<T extends OutboxRow>(outbox: T[], maxCount = 500, maxBytes = 1_000_000): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const r of outbox) {
    const size = r.fields.length + r.row_id.length + 64;
    if (cur.length && (cur.length >= maxCount || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Two devices made a tag with the same name: both keep the smaller id, so they converge (D225). */
export const tagWinner = (a: string, b: string) => (a < b ? a : b);
