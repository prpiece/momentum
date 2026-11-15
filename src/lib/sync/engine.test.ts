import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { numberedParams, type Driver } from "../../db/client";
import { pendingFields, planApply, type SyncTable } from "../../domain/sync";

vi.mock("./supabase", () => ({ supabase: {}, syncConfigured: false, restoreSession: async () => null }));
const { applyOp } = await import("./engine");

const DIR = "src-tauri/migrations";
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(`${DIR}/${f}`, "utf8"));
  db.exec("PRAGMA foreign_keys = ON");
  const d: Driver = {
    select: async <T,>(sql: string, p: unknown[] = []) => db.prepare(numberedParams(sql)).all(...(p as SQLInputValue[])) as T,
    execute: async (sql, p = []) => ({ rowsAffected: Number(db.prepare(numberedParams(sql)).run(...(p as SQLInputValue[])).changes) }),
  };
  return { db, d };
};
const cols = (db: DatabaseSync) =>
  Object.fromEntries(["tasks", "task_activity", "lists", "tags"].map((t) => [t, (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)])) as Record<SyncTable, string[]>;
const at = "2026-11-01T00:00:00.000Z";

describe("applyOp", () => {
  it("applies a task whose updated_at is pending locally instead of failing NOT NULL", async () => {
    const { db, d } = fresh();
    db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at) VALUES ('t1', 'Mine', 'inbox', 'open', 0, 0, ?, ?)").run(at, at);
    const remote = { tbl: "tasks" as const, id: "t1", version: 2, data: { id: "t1", title: "Theirs", priority: 3, updated_at: "2026-11-02T00:00:00.000Z" } };
    // A local edit to title and updated_at is still in the outbox: those fields stay local.
    const [op] = planApply([remote], pendingFields([{ seq: 1, tbl: "tasks", row_id: "t1", fields: JSON.stringify({ title: "Mine", updated_at: at }) }]), cols(db));
    expect(op.kind).toBe("upsert");
    if (op.kind === "settings") return;
    expect(await applyOp(d, op)).toBeNull();
    expect(db.prepare("SELECT title, priority, updated_at FROM tasks WHERE id = 't1'").get()).toEqual({ title: "Mine", priority: 3, updated_at: at });
  });

  it("still inserts new rows, and skips activity for a task that isn't here", async () => {
    const { db, d } = fresh();
    const task = { id: "t2", title: "New", list_id: "inbox", status: "open", priority: 0, sort_order: 0, created_at: at, updated_at: at };
    const ops = planApply(
      [
        { tbl: "tasks", id: "t2", version: 1, data: task },
        { tbl: "task_activity", id: "a1", version: 1, data: { id: "a1", task_id: "gone", kind: "created", at } },
      ],
      new Map(),
      cols(db),
    );
    for (const op of ops) if (op.kind !== "settings") expect(await applyOp(d, op)).toBeNull();
    expect(db.prepare("SELECT title FROM tasks WHERE id = 't2'").get()).toEqual({ title: "New" });
    expect(db.prepare("SELECT count(*) AS n FROM task_activity").get()).toEqual({ n: 0 });
  });

  // Seen live on 2026-11-15: records for tasks this device never had, pointing at what isn't here.
  it("puts a new task whose list never arrived in the Inbox, and drops a missing parent and section", async () => {
    const { db, d } = fresh();
    const task = { id: "t3", title: "Lost list", list_id: "never-synced", parent_id: "no-parent", section_id: "no-section", status: "open", priority: 0, sort_order: 0, created_at: at, updated_at: at };
    const [op] = planApply([{ tbl: "tasks", id: "t3", version: 1, data: task }], new Map(), cols(db));
    if (op.kind === "settings") throw new Error("expected an upsert");
    expect(await applyOp(d, op)).toBeNull();
    expect(db.prepare("SELECT list_id, parent_id, section_id FROM tasks WHERE id = 't3'").get()).toEqual({ list_id: "inbox", parent_id: null, section_id: null });
  });

  it("skips a fragment for a task that isn't here instead of failing NOT NULL", async () => {
    const { db, d } = fresh();
    const fragment = { tbl: "tasks" as const, id: "t4", version: 5, data: { exdates: "[]", updated_at: at } };
    const [op] = planApply([fragment], new Map(), cols(db));
    if (op.kind === "settings") throw new Error("expected an upsert");
    expect(await applyOp(d, op)).toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM tasks WHERE id = 't4'").get()).toEqual({ n: 0 });
  });
});

const applyAll = async (d: Driver, ops: ReturnType<typeof planApply>) => {
  for (const op of ops) if (op.kind !== "settings") expect(await applyOp(d, op)).toBeNull();
};
describe("SYNC-01: a task trashed on another device", () => {
  it("lands in this device's Trash with its activity, instead of being hard-deleted", async () => {
    const { db, d } = fresh();
    db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at) VALUES ('t1', 'Keep', 'inbox', 'open', 0, 0, ?, ?)").run(at, at);
    db.prepare("INSERT INTO task_activity (id, task_id, at, kind) VALUES ('a1', 't1', ?, 'created')").run(at);
    const trashed = { id: "t1", title: "Keep", list_id: "inbox", status: "open", priority: 0, sort_order: 0, created_at: at, updated_at: at, deleted_at: "2026-11-02T00:00:00.000Z" };
    await applyAll(d, planApply([{ tbl: "tasks", id: "t1", version: 2, data: trashed }], new Map(), cols(db)));
    expect(db.prepare("SELECT deleted_at FROM tasks WHERE id = 't1'").get()).toEqual({ deleted_at: "2026-11-02T00:00:00.000Z" });
    expect(db.prepare("SELECT count(*) AS n FROM task_activity").get()).toEqual({ n: 1 });
  });

  it("still deletes on a bare tombstone, and doesn't bring back a trashed task this device no longer has", async () => {
    const { db, d } = fresh();
    db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at) VALUES ('t1', 'Gone', 'inbox', 'open', 0, 0, ?, ?)").run(at, at);
    const purged = { ...{ id: "t2", title: "Purged here", list_id: "inbox", status: "open", priority: 0, sort_order: 0, created_at: at, updated_at: at }, deleted_at: at };
    await applyAll(d, planApply([{ tbl: "tasks", id: "t1", version: 2, data: { deleted_at: at } }, { tbl: "tasks", id: "t2", version: 3, data: purged }], new Map(), cols(db)));
    expect(db.prepare("SELECT count(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  });
});

describe("SYNC-03: the same tag name made on two devices", () => {
  it("moves this device's tasks from the losing tag id to the winner and pushes that", async () => {
    const { db, d } = fresh();
    db.prepare("INSERT INTO tags (id, name) VALUES ('b2', 'work')").run();
    db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at, tags) VALUES ('t2', 'Y', 'inbox', 'open', 0, 0, ?, ?, '[\"b2\",\"x\"]')").run(at, at);
    await applyAll(d, planApply([{ tbl: "tags", id: "a1", version: 1, data: { id: "a1", name: "work" } }], new Map(), cols(db)));
    expect(db.prepare("SELECT id FROM tags").all()).toEqual([{ id: "a1" }]);
    expect(JSON.parse((db.prepare("SELECT tags FROM tasks WHERE id = 't2'").get() as { tags: string }).tags)).toEqual(["a1", "x"]);
    const patch = db.prepare("SELECT fields FROM sync_outbox WHERE tbl = 'tasks' AND row_id = 't2'").get() as { fields: string };
    expect(JSON.parse(JSON.parse(patch.fields).tags)).toEqual(["a1", "x"]);
  });

  it("also remaps tasks here that carry the loser id when the remote tag loses", async () => {
    const { db, d } = fresh();
    db.prepare("INSERT INTO tags (id, name) VALUES ('a1', 'Work')").run();
    db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at, tags) VALUES ('t3', 'X', 'inbox', 'open', 0, 0, ?, ?, '[\"b2\",\"a1\"]')").run(at, at);
    await applyAll(d, planApply([{ tbl: "tags", id: "b2", version: 1, data: { id: "b2", name: "work" } }], new Map(), cols(db)));
    expect(db.prepare("SELECT id FROM tags").all()).toEqual([{ id: "a1" }]);
    expect(JSON.parse((db.prepare("SELECT tags FROM tasks WHERE id = 't3'").get() as { tags: string }).tags)).toEqual(["a1"]);
  });
});

describe("SYNC-07: a remote delete over a task this device hasn't pushed yet", () => {
  it("keeps the new task, moved to the Inbox (or top level), and pushes the move", async () => {
    const { db, d } = fresh();
    db.prepare("INSERT INTO lists (id, name, sort_order) VALUES ('L', 'L', 1)").run();
    db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at) VALUES ('p', 'Parent', 'inbox', 'open', 0, 0, ?, ?)").run(at, at);
    db.prepare("UPDATE sync_state SET value = '1' WHERE key = 'record'").run();
    db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at) VALUES ('new', 'New', 'L', 'open', 0, 0, ?, ?)").run(at, at);
    db.prepare("INSERT INTO tasks (id, title, list_id, parent_id, status, priority, sort_order, created_at, updated_at) VALUES ('sub', 'Sub', 'inbox', 'p', 'open', 0, 0, ?, ?)").run(at, at);
    db.prepare("UPDATE sync_state SET value = '0' WHERE key = 'record'").run();
    await applyAll(d, planApply([{ tbl: "lists", id: "L", version: 2, data: { deleted_at: at } }, { tbl: "tasks", id: "p", version: 3, data: { deleted_at: at } }], new Map(), cols(db)));
    expect(db.prepare("SELECT id, list_id, parent_id FROM tasks ORDER BY id").all()).toEqual([
      { id: "new", list_id: "inbox", parent_id: null },
      { id: "sub", list_id: "inbox", parent_id: null },
    ]);
    const last = (id: string) => JSON.parse((db.prepare("SELECT fields FROM sync_outbox WHERE row_id = ? ORDER BY seq DESC").get(id) as { fields: string }).fields);
    expect(last("new")).toMatchObject({ list_id: "inbox" });
    expect(last("sub")).toMatchObject({ parent_id: null });
  });
});

describe("H15: a fresh sign-in queues only what the server lacks", () => {
  it("skips rows the server already sent (the default Inbox) and queues the rest", async () => {
    const { db, d } = fresh();
    db.prepare("DELETE FROM sync_outbox").run();
    db.prepare("INSERT INTO lists (id, name, sort_order) VALUES ('mine', 'Mine', 1)").run();
    const theirs = [{ tbl: "lists" as const, id: "inbox", version: 1, data: { id: "inbox", name: "Inbox" } }];
    const { queueLocalRows } = await import("./engine");
    const counts = await queueLocalRows(d, theirs, at);
    const queued = (db.prepare("SELECT row_id FROM sync_outbox WHERE tbl = 'lists'").all() as { row_id: string }[]).map((r) => r.row_id);
    expect(queued).toEqual(["mine"]);
    expect(counts.lists).toBe(1);
  });
});

describe("H14: expired JWT", () => {
  it("recognises PostgREST's expired-token codes only", async () => {
    const { isExpiredJwt } = await import("./engine");
    expect(isExpiredJwt({ code: "PGRST301" })).toBe(true);
    expect(isExpiredJwt({ code: "PGRST303" })).toBe(true);
    expect(isExpiredJwt({ code: "23505" })).toBe(false);
    expect(isExpiredJwt(null)).toBe(false);
  });
});
