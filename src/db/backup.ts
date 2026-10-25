import { hydrateCountdowns, saveCountdowns } from "../stores/countdowns";
import { hydrate } from "../stores/data";
import { hydrateFocus, saveSessions } from "../stores/focus";
import { hydrateHabits, saveHabitData } from "../stores/habits";
import { useSettings } from "../stores/settings";
import { isTauri, select, write } from "./client";
import { BACKUP_FORMAT, BACKUP_TABLES, validateBackup, type BackupFile, type Restored } from "./backupFormat";
import type { Row } from "./rows";
import { parseIcs } from "../domain/ics";
import { saveEvents, saveWorkspace } from "./repo";

const LATEST_SCHEMA = 5;

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import("@tauri-apps/api/core");
  return inv<T>(cmd, args);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

/** Export every table as JSON to a file the user picks. Returns the path, or null if cancelled. */
export async function exportBackup(): Promise<string | null> {
  const tables = Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async (t) => [t, await select<Row>(`SELECT * FROM ${t}`)] as const)));
  const file = { app: "Momentum", format: BACKUP_FORMAT, schemaVersion: LATEST_SCHEMA, exportedAt: new Date().toISOString(), tables } satisfies Omit<BackupFile, "tables"> & { tables: Record<string, Row[]> };
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: `momentum-backup-${stamp().slice(0, 10)}.json`, filters: [{ name: "Momentum backup", extensions: ["json"] }] });
  if (!path) return null;
  await invoke("write_text_file", { path: path.toLowerCase().endsWith(".json") ? path : `${path}.json`, contents: JSON.stringify(file, null, 1) });
  return path;
}

export async function pickFile(extension: "json" | "ics", name: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ multiple: false, directory: false, filters: [{ name, extensions: [extension] }] });
  return typeof path === "string" ? path : null;
}

/** Read + validate a backup without touching the database (the UI confirms with the counts first). */
export async function readBackup(path: string) {
  const text = await invoke<string>("read_text_file", { path });
  try {
    return validateBackup(JSON.parse(text));
  } catch {
    return { ok: false as const, error: "The file isn't valid JSON." };
  }
}

/** Consistent snapshot of the live database (SQLite VACUUM INTO), e.g. before an import. */
export async function snapshotDatabase(reason: string): Promise<string> {
  const dir = await invoke<string>("backups_dir", {});
  const { join } = await import("@tauri-apps/api/path");
  const path = await join(dir, `momentum-${reason}-${stamp()}.db`);
  await write(["VACUUM INTO $1", [path]]);
  return path;
}

/**
 * Replace all data with a validated backup. A snapshot of the current database is taken first;
 * if anything fails midway, that snapshot is the way back (shown to the user).
 * ponytail: sequential writes, not one transaction (plugin-sql pools connections); upgrade to a
 * Rust-side transaction if partial restores ever happen in practice.
 */
export async function restoreBackup(d: Restored): Promise<string> {
  const snapshot = await snapshotDatabase("before-import");
  await write(...[...BACKUP_TABLES, "reminder_log"].reverse().map((t): [string] => [`DELETE FROM ${t}`]));
  await saveWorkspace({ tasks: d.tasks, events: d.events, lists: d.lists, folders: d.folders, sections: d.sections, tags: d.tags });
  await write(...d.activity.map((a): [string, unknown[]] => ["INSERT INTO task_activity (task_id, at, kind, detail) VALUES ($1, $2, $3, $4)", [a.taskId, a.at, a.kind, a.detail]]));
  await saveHabitData({ habits: d.habits, groups: d.groups, checkins: d.checkins });
  await saveCountdowns(d.countdowns);
  await saveSessions(d.sessions);
  if (d.settings) useSettings.getState().update(d.settings);
  await Promise.all([hydrate(), hydrateHabits(), hydrateCountdowns(), hydrateFocus(), useSettings.getState().hydrate()]);
  return snapshot;
}

/** Import (or re-import: ids are stable) read-only events from an .ics file. */
export async function importIcs(path: string, color: string) {
  const text = await invoke<string>("read_text_file", { path });
  const { events, skipped } = parseIcs(text, color);
  if (!isTauri) return { count: 0, skipped };
  await saveEvents(events);
  await hydrate();
  return { count: events.length, skipped };
}
