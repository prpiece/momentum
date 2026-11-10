import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { eventCountdown } from "../domain/countdown";
import { parseEvent, type Row } from "./rows";

const DIR = "src-tauri/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const apply = (db: DatabaseSync, from: number, to: number) => {
  for (const f of files.filter((f) => Number(f.slice(0, 4)) >= from && Number(f.slice(0, 4)) <= to)) db.exec(readFileSync(`${DIR}/${f}`, "utf8"));
};
const at = "2026-01-01T00:00:00.000Z";

describe("0008 countdowns to events", () => {
  it("converts every direction, repeat and icon, then drops the table", () => {
    const db = new DatabaseSync(":memory:");
    apply(db, 1, 7);
    const add = db.prepare("INSERT INTO countdowns (id, title, date, direction, repeat, emoji, color, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    add.run("a", "Trip", "2026-12-25", "until", "none", "hourglass", "#2f6fed", 1, at);
    add.run("b", "Birthday", "1990-03-14", "until", "yearly", "🎂", "#d6457a", 0, at);
    add.run("c", "Rent", "2026-01-31", "until", "monthly", "⏳", "#5b5bd6", 0, at);
    add.run("d", "Sober", "2025-06-01", "since", "none", "gift", "#2f9358", 0, at);
    apply(db, 8, 8);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'countdowns'").all();
    expect(tables).toEqual([]);
    const events = Object.fromEntries(
      (db.prepare("SELECT * FROM calendar_events").all() as Row[]).map(parseEvent).map((e) => [e!.id, e!]),
    );
    expect(Object.keys(events).sort()).toEqual(["a", "b", "c", "d"]);
    expect(events.a).toMatchObject({ title: "Trip", schedule: { kind: "day", date: "2026-12-25" }, spanDays: 1, recurrence: null, countdown: "until", pinned: true, color: "#2f6fed" });
    expect(events.b.title).toBe("🎂 Birthday");
    expect(events.c.title).toBe("Rent");
    expect(events.d.title).toBe("Sober");
    expect(eventCountdown(events.b)).toEqual({ date: "1990-03-14", direction: "until", repeat: "yearly" });
    expect(eventCountdown(events.c)?.repeat).toBe("monthly");
    expect(eventCountdown(events.d)).toEqual({ date: "2025-06-01", direction: "since", repeat: "none" });
  });

  it("works on a database with no countdowns", () => {
    const db = new DatabaseSync(":memory:");
    apply(db, 1, 8);
    expect(db.prepare("SELECT count(*) AS n FROM calendar_events").get()).toEqual({ n: 0 });
  });
});

describe("0009 sync outbox triggers", () => {
  const fresh = () => {
    const db = new DatabaseSync(":memory:");
    apply(db, 1, 99);
    return db;
  };
  const outbox = (db: DatabaseSync) =>
    (db.prepare("SELECT tbl, row_id, fields FROM sync_outbox ORDER BY seq").all() as { tbl: string; row_id: string; fields: string }[]).map((r) => ({
      ...r,
      fields: JSON.parse(r.fields) as Record<string, unknown>,
    }));
  const record = (db: DatabaseSync, on: boolean) => db.prepare("UPDATE sync_state SET value = ? WHERE key = 'record'").run(on ? "1" : "0");

  it("records nothing while signed out", () => {
    const db = fresh();
    db.exec("INSERT INTO rest_days (date) VALUES ('2026-01-01')");
    expect(outbox(db)).toEqual([]);
  });

  it("records creates in full, updates as changed fields only, deletes as tombstones", () => {
    const db = fresh();
    record(db, true);
    db.exec("INSERT INTO lists (id, name) VALUES ('l1', 'Work')");
    db.exec("UPDATE lists SET name = 'Job' WHERE id = 'l1'");
    db.exec("UPDATE lists SET name = 'Job' WHERE id = 'l1'");
    db.exec("DELETE FROM lists WHERE id = 'l1'");
    const [ins, upd, del, ...rest] = outbox(db);
    expect(rest).toEqual([]);
    expect(ins).toMatchObject({ tbl: "lists", row_id: "l1", fields: { id: "l1", name: "Work", pinned: 0, deleted_at: null } });
    expect(upd).toEqual({ tbl: "lists", row_id: "l1", fields: { name: "Job" } });
    expect(Object.keys(del.fields)).toEqual(["deleted_at"]);
  });

  it("names natural-key rows by their key and sends check-in values as increments", () => {
    const db = fresh();
    db.exec("INSERT INTO habits (id, name, start_date, created_at) VALUES ('h', 'Run', '2026-01-01', '2026-01-01T00:00:00.000Z')");
    record(db, true);
    db.exec("INSERT INTO habit_checkins (habit_id, date, value) VALUES ('h', '2026-01-02', 2)");
    db.exec("UPDATE habit_checkins SET value = 5 WHERE habit_id = 'h'");
    const [ins, upd] = outbox(db);
    expect(ins).toMatchObject({ row_id: "h|2026-01-02", fields: { _delta: 2 } });
    expect(ins.fields).not.toHaveProperty("value");
    expect(upd.fields).toEqual({ _delta: 3 });
  });

  it("tombstones rows removed by a foreign-key cascade", () => {
    const db = fresh();
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("INSERT INTO lists (id, name) VALUES ('l1', 'Work')");
    db.exec("INSERT INTO tasks (id, title, list_id, created_at, updated_at) VALUES ('t1', 'A', 'l1', 'x', 'x')");
    record(db, true);
    db.exec("DELETE FROM lists WHERE id = 'l1'");
    expect(outbox(db).map((r) => `${r.tbl}:${r.row_id}`).sort()).toEqual(["lists:l1", "tasks:t1"]);
  });

  it("gives every activity row its own text id, keeping old rows", () => {
    const db = new DatabaseSync(":memory:");
    apply(db, 1, 8);
    db.exec("INSERT INTO lists (id, name) VALUES ('l1', 'Work')");
    db.exec("INSERT INTO tasks (id, title, list_id, created_at, updated_at) VALUES ('t1', 'A', 'l1', 'x', 'x')");
    db.exec("INSERT INTO task_activity (task_id, at, kind) VALUES ('t1', 'x', 'created')");
    apply(db, 9, 9);
    db.exec("INSERT INTO task_activity (task_id, at, kind) VALUES ('t1', 'y', 'completed')");
    const ids = (db.prepare("SELECT id FROM task_activity").all() as { id: unknown }[]).map((r) => r.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("has triggers that cover every column of every synced table (regenerate them after a schema change)", async () => {
    // @ts-expect-error plain .mjs build script without types
    const { SYNCED, columns } = await import("../../scripts/sync-triggers.mjs");
    const db = fresh();
    const sql = (name: string) => (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name) as { sql: string } | undefined)?.sql ?? "";
    for (const t of Object.keys(SYNCED as Record<string, string>)) {
      const ins = sql(`sync_ins_${t}`);
      const upd = sql(`sync_upd_${t}`);
      expect(sql(`sync_del_${t}`), t).not.toBe("");
      for (const c of columns(db, t) as string[]) {
        expect(ins, `${t}.${c} insert`).toContain(`NEW.${c}`);
        expect(upd, `${t}.${c} update`).toContain(`OLD.${c} IS NOT NEW.${c}`);
      }
    }
  });
});

it("the trigger generator and src/domain/sync.ts list the same tables", async () => {
  // @ts-expect-error plain .mjs build script without types
  const { SYNCED } = await import("../../scripts/sync-triggers.mjs");
  const { SYNC_TABLES } = await import("../domain/sync");
  expect(Object.keys(SYNCED as object)).toEqual(Object.keys(SYNC_TABLES));
});
