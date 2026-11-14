/*
 * D257: every synced field ships on both apps, and an older app must not drop fields it doesn't know.
 * Real SQLite (the shipped migrations and triggers), a field-merging stand-in for the server
 * (`sync_rows.data` is merged key by key), and the pure pull planner.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { planApply, type RemoteRow, type SyncTable } from "../domain/sync";
import type { Task } from "../domain/types";
import { parseTask, taskToRow, type Row } from "./rows";

const DIR = "src-tauri/migrations";
function device(through: number) {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) if (Number(f.slice(0, 4)) <= through) db.exec(readFileSync(`${DIR}/${f}`, "utf8"));
  db.exec("UPDATE sync_state SET value = '1' WHERE key = 'record'");
  return db;
}
const cols = (db: DatabaseSync, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((r) => r.name);
const upsert = (db: DatabaseSync, t: string, row: Row) => {
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`).run(
    ...(Object.values(row) as (string | number | null)[]),
  );
};

/** Push: drain the outbox into the server's merged rows. */
function push(db: DatabaseSync, server: Map<string, Record<string, unknown>>) {
  for (const r of db.prepare("SELECT tbl, row_id, fields FROM sync_outbox ORDER BY seq").all() as { tbl: string; row_id: string; fields: string }[])
    server.set(`${r.tbl}|${r.row_id}`, { ...server.get(`${r.tbl}|${r.row_id}`), ...JSON.parse(r.fields) });
  db.exec("DELETE FROM sync_outbox");
}
/** Pull: apply the server's rows the way the engine does (only known columns, recording off). */
function pull(db: DatabaseSync, server: Map<string, Record<string, unknown>>) {
  const remote: RemoteRow[] = [...server].map(([k, data], i) => ({ tbl: k.split("|")[0] as SyncTable, id: k.split("|")[1], data, version: i + 1 }));
  const columns = Object.fromEntries(["lists", "tasks"].map((t) => [t, cols(db, t)])) as Record<SyncTable, string[]>;
  db.exec("UPDATE sync_state SET value = '0' WHERE key = 'record'");
  for (const op of planApply(remote, new Map(), columns)) if (op.kind === "upsert") upsert(db, op.tbl, op.row);
  db.exec("UPDATE sync_state SET value = '1' WHERE key = 'record'");
}
const read = (db: DatabaseSync, id: string) => parseTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row);

const task: Task = {
  id: "t1", title: "Call mom", description: "", listId: "inbox", parentId: null, sectionId: null, status: "open", priority: 2,
  schedule: { kind: "someday" }, deadline: "2026-11-20", durationMin: 15, waiting: { kind: "person", who: "Sam", followUp: "2026-11-18" },
  recurrence: null, recurrenceParentId: null, tags: [], checklist: [], reminders: [], sortOrder: 0, pinned: false,
  createdAt: "2026-11-14T00:00:00.000Z", updatedAt: "2026-11-14T00:00:00.000Z", completedAt: null, deletedAt: null,
};

describe("planning fields through sync (D257)", () => {
  it("round-trip from desktop to a current phone", () => {
    const server = new Map<string, Record<string, unknown>>();
    const desktop = device(99);
    upsert(desktop, "tasks", taskToRow(task));
    push(desktop, server);
    const phone = device(99);
    pull(phone, server);
    expect(read(phone, "t1")).toEqual(task);
  });

  it("an older phone that edits the task doesn't drop fields it doesn't know", () => {
    const server = new Map<string, Record<string, unknown>>();
    const desktop = device(99);
    upsert(desktop, "tasks", taskToRow(task));
    push(desktop, server);

    const oldPhone = device(9); // v1.1/v1.2 schema: no deadline, duration_min, someday or waiting
    pull(oldPhone, server);
    oldPhone.prepare("UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?").run("Call mom back", "2026-11-15T00:00:00.000Z", "t1");
    push(oldPhone, server);

    const phone = device(99);
    pull(phone, server);
    expect(read(phone, "t1")).toEqual({ ...task, title: "Call mom back", updatedAt: "2026-11-15T00:00:00.000Z" });
    pull(desktop, server);
    expect(read(desktop, "t1")?.deadline).toBe("2026-11-20");
  });
});
