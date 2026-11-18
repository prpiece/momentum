import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { numberedParams, setDriver } from "../db/client";
import { taskToRow } from "../db/rows";
import { addList, addSection, addTask, deleteTasks, hydrate, purgeTasks, removeList, removeSection, replaceAll, updateTask, useData } from "./data";

// Real schema, real write chain: what the store does when the database says no, or reads while an edit is in flight.
const DIR = "src-tauri/migrations";
let db: DatabaseSync;
let gate: Promise<void> | null = null;
let afterWrite: (() => void) | null = null;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(`${DIR}/${f}`, "utf8"));
  gate = null;
  afterWrite = null;
  setDriver(async () => ({
    select: async <T,>(sql: string, p: unknown[] = []) => {
      const rows = db.prepare(numberedParams(sql)).all(...(p as never[])) as T;
      if (gate) await gate;
      return rows;
    },
    execute: async (sql, p = []) => {
      const rowsAffected = Number(db.prepare(numberedParams(sql)).run(...(p as never[])).changes);
      afterWrite?.();
      return { rowsAffected };
    },
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

  const hydrateWhile = async (edit: () => void) => {
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const loading = hydrate(false);
    await settle();
    edit();
    release();
    await loading;
    await settle();
  };

  it("SYNC-14: a task purged, and a list or section removed, while a hydrate was reading stay gone", async () => {
    const t = addTask({ title: "t" });
    const l = addList("l");
    const s = addSection(l.id, "s");
    const l2 = addList("l2");
    const s2 = addSection(l2.id, "s2");
    deleteTasks([t.id]);
    await settle();
    await hydrateWhile(() => {
      purgeTasks([t.id]);
      removeList(l.id);
      removeSection(s2.id);
    });
    const st = useData.getState();
    expect(st.tasks[t.id]).toBeUndefined();
    expect(st.lists[l.id]).toBeUndefined();
    expect(st.sections[s.id]).toBeUndefined();
    expect(st.sections[s2.id]).toBeUndefined();
    expect(st.lists[l2.id]).toBeDefined();
  });

  it("SYNC-14: a list and section added while a hydrate was reading don't vanish", async () => {
    let added!: [string, string];
    await hydrateWhile(() => {
      const l = addList("new");
      added = [l.id, addSection(l.id, "sec").id];
    });
    const st = useData.getState();
    expect(st.lists[added[0]]).toBeDefined();
    expect(st.sections[added[1]]).toBeDefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM lists WHERE id = ?").get(added[0])).toEqual({ n: 1 });
  });

  it("SYNC-14: overlapping hydrates: the later read wins over the earlier one's set, and an edit made meanwhile is still kept", async () => {
    const t = addTask({ title: "old" });
    const u = addTask({ title: "u" });
    await settle();
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const a = hydrate(false); // reads "old", then waits
    await settle();
    db.prepare("UPDATE tasks SET title = 'newer' WHERE id = ?").run(t.id); // e.g. a pull lands
    const b = hydrate(false); // will read "newer"
    await settle();
    updateTask(u.id, { title: "edited" });
    release();
    await Promise.all([a, b]);
    await settle();
    expect(useData.getState().tasks[t.id].title).toBe("newer");
    expect(useData.getState().tasks[u.id].title).toBe("edited");
  });

  it("SYNC-14: a row edited during a post-pull read converges to SQLite's merged row afterwards", async () => {
    const t = addTask({ title: "old", priority: 0 });
    await settle();
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const loading = hydrate(false); // read sees "old"
    await settle();
    updateTask(t.id, { priority: 3 }); // local edit; the store row still says "old"
    // the pull's per-field merge in SQLite: remote title + the local priority, once the edit's write has landed
    afterWrite = () => db.prepare("UPDATE tasks SET title = 'remote' WHERE id = ?").run(t.id);
    release();
    await loading;
    await settle();
    expect(useData.getState().tasks[t.id]).toMatchObject({ title: "remote", priority: 3 });
  });

  it("a hydrate with no concurrent edits just loads what is stored", async () => {
    const l = addList("l");
    await settle();
    replaceAll({ tasks: [], events: [], lists: [], folders: [], sections: [], tags: [] });
    await hydrate(false);
    expect(useData.getState().lists[l.id]?.name).toBe("l");
    await hydrate(false);
    expect(Object.keys(useData.getState().lists)).toContain(l.id);
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
