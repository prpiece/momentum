import { hydrate } from "../stores/data";
import { hydrateFocus, saveSessions } from "../stores/focus";
import { hydrateHabits, saveHabitData } from "../stores/habits";
import { useSettings } from "../stores/settings";
import { failedWrites, isTauri, select, write } from "./client";
import { BACKUP_FORMAT, BACKUP_TABLES, LATEST_SCHEMA, validateBackup, type BackupFile, type Restored } from "./backupFormat";
import type { Row } from "./rows";
import { parseIcs } from "../domain/ics";
import { saveEvents, saveSubscription, saveWorkspace } from "./repo";
import { hydrateSubscriptions } from "../stores/subscriptions";

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import("@tauri-apps/api/core");
  return inv<T>(cmd, args);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

/** Export every table as JSON, zipped with the note attachments, to a file the user picks. Returns the path, or null if cancelled. */
export async function exportBackup(): Promise<string | null> {
  const tables = Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async (t) => [t, await select<Row>(`SELECT * FROM ${t}`)] as const)));
  const file = { app: "Momentum", format: BACKUP_FORMAT, schemaVersion: LATEST_SCHEMA, exportedAt: new Date().toISOString(), tables } satisfies Omit<BackupFile, "tables"> & { tables: Record<string, Row[]> };
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: `momentum-backup-${stamp().slice(0, 10)}.zip`, filters: [{ name: "Momentum backup", extensions: ["zip"] }] });
  if (!path) return null;
  await invoke("write_backup_zip", { path: isZip(path) ? path : `${path}.zip`, json: JSON.stringify(file, null, 1) });
  return path;
}

const isZip = (path: string) => path.toLowerCase().endsWith(".zip");

export async function pickFile(extensions: string[], name: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ multiple: false, directory: false, filters: [{ name, extensions }] });
  return typeof path === "string" ? path : null;
}

/** Read + validate a backup (.zip or .json) without touching the database (the UI confirms with the counts first). */
export async function readBackup(path: string) {
  const text = await invoke<string>(isZip(path) ? "read_backup_zip" : "read_text_file", { path });
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
export async function restoreBackup(d: Restored, path: string): Promise<string> {
  const snapshot = await snapshotDatabase("before-import");
  if (isZip(path)) await invoke("restore_backup_attachments", { path });
  // write() swallows errors; failedWrites turns the first one into a throw, so a half-restored database is reported, not "restored".
  try {
    await failedWrites(async () => {
      await write(...[...BACKUP_TABLES, "reminder_log"].reverse().map((t): [string] => [`DELETE FROM ${t}`]));
      await Promise.all(d.subscriptions.map(saveSubscription));
      await saveWorkspace({ tasks: d.tasks, events: d.events, lists: d.lists, folders: d.folders, sections: d.sections, tags: d.tags });
      await write(...d.activity.map((a): [string, unknown[]] => ["INSERT INTO task_activity (task_id, at, kind, detail) VALUES ($1, $2, $3, $4)", [a.taskId, a.at, a.kind, a.detail]]));
      await saveHabitData({ habits: d.habits, groups: d.groups, checkins: d.checkins });
      await saveSessions(d.sessions);
      // Saved at once: a debounced update() would fire after the hydrate below and write the defaults back over them (H9).
      if (d.settings) await useSettings.getState().replace(d.settings);
    });
  } catch (err) {
    await hydrate(); // show what the database holds now
    throw new Error(`The restore failed partway (${err instanceof Error ? err.message : String(err)}). Your previous data is in ${snapshot}`);
  }
  await Promise.all([hydrate(), hydrateSubscriptions(), hydrateHabits(), hydrateFocus(), useSettings.getState().hydrate()]);
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

/** A text export from another app (Todoist, TickTick), read through the same Rust command as the .ics import. */
export const readTextFile = (path: string) => invoke<string>("read_text_file", { path });
