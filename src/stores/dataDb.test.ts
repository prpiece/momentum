import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { numberedParams, setDriver } from "../db/client";
import { taskToRow } from "../db/rows";
import { addTask, hydrate, replaceAll, updateTask, useData } from "./data";

// Real schema, real write chain: what the store does when the database says no, or reads while an edit is in flight.
const DIR = "src-tauri/migrations";
let db: DatabaseSync;
let gate: Promise<void> | null = null;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(`${DIR}/${f}`, "utf8"));
  gate = null;
  setDriver(async () => ({
    select: async <T,>(sql: string, p: unknown[] = []) => {
      const rows = db.prepare(numberedParams(sql)).all(...(p as never[])) as T;
      if (gate) await gate;
      return rows;
    },
    execute: async (sql, p = []) => ({ rowsAffected: Number(db.prepare(numberedParams(sql)).run(...(p as never[])).changes) }),
  }));
  replaceAll({ tasks: [], events: [], lists: [], folders: [], sections: [], tags: [] });
});
const settle = () => new Promise((r) => setTimeout(r, 30));

describe("write failures and hydrate", () => {
  it("DATA-11: a write the database rejects is rolled back in the store", async () => {
    await hydrate(false); // startup: registers the reload listener
    const t = addTask({ title: "ok" });
    await settle();
    updateTask(t.id, { priority: 9 as never }); // violates the priority CHECK
    expect(useData.getState().tasks[t.id].priority).toBe(9);
    await settle();
    expect(useData.getState().tasks[t.id].priority).toBe(0);
  });

  it("SYNC-14: a hydrate that was reading when an edit was made doesn't undo the edit", async () => {
    const t = addTask({ title: "old" });
    await settle();
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const loading = hydrate(false);
    await settle();
    updateTask(t.id, { title: "new" });
    release();
    await loading;
    await settle();
    expect(useData.getState().tasks[t.id].title).toBe("new");
    expect((db.prepare("SELECT title FROM tasks WHERE id = ?").get(t.id) as { title: string }).title).toBe("new");
  });

  it("DATA-04: the launch purge detaches a live subtask before deleting its expired trashed parent", async () => {
    const base = { ...taskToRow(addTask({ title: "x" })) };
    await settle();
    db.exec("DELETE FROM tasks");
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const ins = (id: string, parent: string | null, deleted: string | null) =>
      db.prepare("INSERT INTO tasks (id, title, list_id, parent_id, deleted_at, sort_order, created_at, updated_at) VALUES (?, ?, 'inbox', ?, ?, 0, ?, ?)").run(id, id, parent, deleted, old, old);
    void base;
    ins("p", null, old);
    ins("c", "p", null);
    await hydrate(true);
    expect(Object.keys(useData.getState().tasks)).toEqual(["c"]);
    expect(useData.getState().tasks.c.parentId).toBeNull();
  });
});
