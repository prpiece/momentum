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
  Object.fromEntries(["tasks", "task_activity", "lists"].map((t) => [t, (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)])) as Record<SyncTable, string[]>;
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
});
