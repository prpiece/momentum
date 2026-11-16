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
import { supabase } from "../lib/sync/supabase";
import { useSync } from "../lib/sync/engine";
import { toast } from "../stores/ui";
import { cloudExcess, decryptBackup, encryptBackup, isEncryptedBackup } from "./backupCrypto";

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import("@tauri-apps/api/core");
  return inv<T>(cmd, args);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

async function backupJson(): Promise<string> {
  const tables =Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async (t) => [t, await select<Row>(`SELECT * FROM ${t}`)] as const)));
  const file = { app: "Momentum", format: BACKUP_FORMAT, schemaVersion: LATEST_SCHEMA, exportedAt: new Date().toISOString(), tables } satisfies Omit<BackupFile, "tables"> & { tables: Record<string, Row[]> };
  return JSON.stringify(file, null, 1);
}

/** Export every table as JSON, zipped with the note attachments, to a file the user picks. Returns the path, or null if cancelled. */
export async function exportBackup(): Promise<string | null> {
  const json = await backupJson();
  const path = await invoke<string | null>("pick_path", { save: true, name: "Momentum backup", extensions: ["zip"], defaultName: `momentum-backup-${stamp().slice(0, 10)}.zip` });
  if (!path) return null;
  await invoke("write_backup_zip", { path, json });
  return path;
}

// ---- Automatic backups (FEAT-06): a daily zip in the backup folder, newest `keep` kept ----
// `folder` is the display copy of the folder Rust trusts (set_backup_folder). `encrypt`: the passphrase lives in the OS
// keychain (secret `backup_passphrase`) and the JSON in the zip is replaced by an encrypted envelope (backupCrypto.ts).
// `cloud`: when signed in, the same JSON is also uploaded to the private `backups` bucket under `<account>/`.
export type AutoBackup = { on: boolean; keep: number; last: string | null; folder: string | null; encrypt: boolean; cloud: boolean };
const AUTO_KEY = "momentum.autoBackup";
const AUTO_DEFAULT: AutoBackup = { on: false, keep: 7, last: null, folder: null, encrypt: false, cloud: false };

export function autoBackupSettings(): AutoBackup {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(AUTO_KEY) ?? "null");
    if (typeof v !== "object" || v === null) return AUTO_DEFAULT;
    const o = v as Partial<Record<keyof AutoBackup, unknown>>;
    const keep = typeof o.keep === "number" && o.keep >= 1 && o.keep <= 60 ? Math.floor(o.keep) : AUTO_DEFAULT.keep;
    return { on: o.on === true, keep, last: typeof o.last === "string" ? o.last : null, folder: typeof o.folder === "string" ? o.folder : null, encrypt: o.encrypt === true, cloud: o.cloud === true };
  } catch {
    return AUTO_DEFAULT;
  }
}
export function saveAutoBackupSettings(a: AutoBackup): void {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(a));
  } catch {
    /* private mode: the setting just doesn't stick */
  }
}

/** Pick the folder automatic backups go to (a cloud-synced folder works) and make it stick across restarts; null = cancelled. */
export async function chooseBackupFolder(): Promise<string | null> {
  const path = await invoke<string | null>("pick_path", { save: false, name: "Folder", extensions: [], folder: true });
  if (!path) return null;
  await invoke("set_backup_folder", { path });
  saveAutoBackupSettings({ ...autoBackupSettings(), folder: path });
  return path;
}
export async function useDefaultBackupFolder(): Promise<void> {
  await invoke("set_backup_folder", { path: null });
  saveAutoBackupSettings({ ...autoBackupSettings(), folder: null });
}

const storedPassphrase = () => invoke<string | null>("secret_get", { key: "backup_passphrase" });
/** Keep (or with "" forget) the passphrase for encrypted automatic backups. */
export const setBackupPassphrase = (pass: string) => (pass ? invoke("secret_set", { key: "backup_passphrase", value: pass }) : invoke("secret_delete", { key: "backup_passphrase" }));
export const hasBackupPassphrase = async () => !!(await storedPassphrase());
/** The passphrase to try on an encrypted backup: what the user typed, else the saved one. */
export const restorePassphrase = async (typed: string) => typed || (await storedPassphrase()) || undefined;

const CLOUD = "backups";
const cloudAccount = () => useSync.getState().account;
const CLOUD_NAME = /^momentum-auto-[\d-]+\.json$/;

/** Upload one backup's JSON (or encrypted envelope) and drop the oldest beyond `keep`. */
async function uploadCloud(uid: string, name: string, payload: string, keep: number) {
  const bucket = supabase.storage.from(CLOUD);
  const up = await bucket.upload(`${uid}/momentum-auto-${name}.json`, new Blob([payload], { type: "application/json" }), { contentType: "application/json" });
  if (up.error) throw new Error(up.error.message);
  const list = await bucket.list(uid, { limit: 200 });
  if (list.error) throw new Error(list.error.message);
  const old = cloudExcess(list.data.map((f) => f.name), keep);
  if (old.length) await bucket.remove(old.map((n) => `${uid}/${n}`));
}

/** The account's cloud copies, newest first (file names). Empty when signed out. */
export async function listCloudBackups(): Promise<string[]> {
  const uid = cloudAccount();
  if (!uid) return [];
  const r = await supabase.storage.from(CLOUD).list(uid, { limit: 200 });
  if (r.error) throw new Error(r.error.message);
  return r.data.map((f) => f.name).filter((n) => CLOUD_NAME.test(n)).sort().reverse();
}

/** Write one automatic backup now; returns its path. The cloud copy is best effort: its failure is a toast, not an error. */
export async function backupNow(): Promise<string> {
  const a = autoBackupSettings();
  const json = await backupJson();
  let payload = json;
  if (a.encrypt) {
    const pass = await storedPassphrase();
    if (!pass) throw new Error("Encryption is on but no passphrase is saved. Set one first.");
    payload = await encryptBackup(json, pass);
  }
  const name = stamp();
  const path = await invoke<string>("write_auto_backup", { name, json: payload, keep: a.keep });
  const uid = cloudAccount();
  if (a.cloud && uid) await uploadCloud(uid, name, payload, a.keep).catch((err) => toast(`Cloud copy of the backup failed: ${err instanceof Error ? err.message : String(err)}`));
  saveAutoBackupSettings({ ...autoBackupSettings(), last: new Date().toISOString() });
  return path;
}

/** The day's backup is due when it is on and none was made in the last 20 hours. */
export const autoBackupDue = (a: Pick<AutoBackup, "on" | "last">, now = Date.now()) => a.on && (!a.last || now - Date.parse(a.last) > 20 * 3_600_000);

/** Call once after startup: backs up if due, then re-checks hourly. Failures are logged, never thrown. */
export function startAutoBackup(): void {
  if (!isTauri) return;
  const tick = () => {
    if (autoBackupDue(autoBackupSettings())) backupNow().catch((err) => console.warn("Automatic backup failed", err));
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 3_600_000);
}

const isZip = (path: string) => path.toLowerCase().endsWith(".zip");

export async function pickFile(extensions: string[], name: string): Promise<string | null> {
  return invoke<string | null>("pick_path", { save: false, name, extensions });
}

/** Validate backup text, decrypting first when it is an encrypted envelope (`needsPassphrase`: ask the user and call again). */
export async function parseBackupText(text: string, pass?: string) {
  try {
    if (isEncryptedBackup(text)) {
      if (!pass) return { ok: false as const, needsPassphrase: true as const, error: "This backup is encrypted. Enter its passphrase and try again." };
      text = await decryptBackup(text, pass);
    }
    return validateBackup(JSON.parse(text));
  } catch (err) {
    return { ok: false as const, error: err instanceof SyntaxError ? "The file isn't valid JSON." : err instanceof Error ? err.message : String(err) };
  }
}

/** Read + validate a backup (.zip or .json) without touching the database (the UI confirms with the counts first). */
export async function readBackup(path: string, pass?: string) {
  return parseBackupText(await invoke<string>(isZip(path) ? "read_backup_zip" : "read_text_file", { path }), pass);
}

/** Download a cloud copy and validate it like readBackup. Images are not in cloud copies; they sync separately. */
export async function readCloudBackup(name: string, pass?: string) {
  const uid = cloudAccount();
  if (!uid) return { ok: false as const, error: "Sign in to restore a cloud backup." };
  const r = await supabase.storage.from(CLOUD).download(`${uid}/${name}`);
  if (r.error) return { ok: false as const, error: r.error.message };
  return parseBackupText(await r.data.text(), pass);
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
