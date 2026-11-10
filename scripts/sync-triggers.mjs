// Generates the sync outbox triggers (PLAN D225) from the live schema.
// Usage: node scripts/sync-triggers.mjs <through-migration-number>  → prints SQL.
// Any later migration that adds a column to a synced table must DROP and re-create that table's
// triggers with this output; migrations.test.ts fails when a column is missing from them.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Synced tables and the expression that names a row (natural keys for the three without an id). */
export const SYNCED = {
  folders: "id",
  lists: "id",
  sections: "id",
  tags: "id",
  tasks: "id",
  task_activity: "id",
  calendar_events: "id",
  habit_groups: "id",
  habits: "id",
  habit_checkins: "habit_id || '|' || date",
  focus_sessions: "id",
  rest_days: "date",
  celebrations: "key",
};

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const ON = "(SELECT value FROM sync_state WHERE key = 'record') = '1'";
const key = (t, row) => SYNCED[t].replace(/\b(id|habit_id|date|key)\b/g, `${row}.$1`);
/** Check-in values travel as increments so two devices' check-ins add up (D225). */
const field = (t, c) => (t === "habit_checkins" && c === "value" ? "_delta" : c);

export function columns(db, t) {
  return db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
}

export function triggers(db) {
  const out = [];
  for (const t of Object.keys(SYNCED)) {
    const cols = columns(db, t);
    const all = cols.flatMap((c) => [`'${field(t, c)}'`, `NEW.${c}`]);
    if (!cols.includes("deleted_at")) all.push("'deleted_at'", "NULL");
    const changed = cols
      .map((c) =>
        t === "habit_checkins" && c === "value"
          ? `SELECT '_delta' AS k, NEW.value - OLD.value AS v WHERE OLD.value IS NOT NEW.value`
          : `SELECT '${c}' AS k, NEW.${c} AS v WHERE OLD.${c} IS NOT NEW.${c}`,
      )
      .join("\n      UNION ALL ");
    out.push(
      `CREATE TRIGGER sync_ins_${t} AFTER INSERT ON ${t} WHEN ${ON} BEGIN\n` +
        `  INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('${t}', ${key(t, "NEW")}, json_object(${all.join(", ")}), ${NOW});\nEND;`,
      `CREATE TRIGGER sync_upd_${t} AFTER UPDATE ON ${t} WHEN ${ON} BEGIN\n` +
        `  INSERT INTO sync_outbox (tbl, row_id, fields, created_at)\n` +
        `  SELECT '${t}', ${key(t, "NEW")}, f, ${NOW} FROM (SELECT json_group_object(k, v) AS f FROM (\n      ${changed})) WHERE f <> '{}';\nEND;`,
      `CREATE TRIGGER sync_del_${t} AFTER DELETE ON ${t} WHEN ${ON} BEGIN\n` +
        `  INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('${t}', ${key(t, "OLD")}, json_object('deleted_at', ${NOW}), ${NOW});\nEND;`,
    );
  }
  return out.join("\n\n");
}

/** A database with migrations 1..through applied (pass the SQL of any migration being drafted as `extra`). */
export function schemaDb(through, extra = "") {
  const dir = "src-tauri/migrations";
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort())
    if (Number(f.slice(0, 4)) <= through) db.exec(readFileSync(`${dir}/${f}`, "utf8"));
  if (extra) db.exec(extra);
  return db;
}

if (process.argv[1]?.endsWith("sync-triggers.mjs")) {
  const through = Number(process.argv[2]);
  const extra = process.argv[3] ? readFileSync(process.argv[3], "utf8") : "";
  console.log(triggers(schemaDb(through, extra)));
}
