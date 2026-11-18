import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { setDriver } from "./client";
import { saveSettings } from "./settings";

it("a refused settings write doesn't advance the snapshot, so the next save still sends that change to sync", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE settings (id INTEGER PRIMARY KEY, value TEXT); CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE sync_outbox (tbl, row_id, fields, created_at)");
  db.exec("INSERT INTO sync_state VALUES ('record', '1')");
  let fail = true;
  setDriver(async () => ({
    select: async <T,>() => [] as T,
    execute: async (sql, p = []) => {
      if (fail && sql.startsWith("INSERT INTO settings")) throw new Error("disk full");
      return { rowsAffected: Number(db.prepare(sql.replace(/\$(\d+)/g, "?$1")).run(...(p as never[])).changes) };
    },
  }));
  const dark = { ...DEFAULT_SETTINGS, theme: "dark" as const };
  await saveSettings(dark); // refused: nothing reached SQLite
  fail = false;
  await saveSettings({ ...dark, accent: "violet" as never });
  const fields = (db.prepare("SELECT fields FROM sync_outbox").all() as { fields: string }[]).map((r) => JSON.parse(r.fields));
  expect(fields).toHaveLength(1);
  expect(fields[0]).toMatchObject({ theme: "dark", accent: "violet" });
});
