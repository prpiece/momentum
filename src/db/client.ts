import Database from "@tauri-apps/plugin-sql";

/** False when the frontend runs in a plain browser (`npm run dev`): the UI works, nothing persists. */
export const isTauri = "__TAURI_INTERNALS__" in window;

let conn: Promise<Database> | undefined;

/** Opening the DB is what triggers the plugin's migrations (registered in src-tauri/src/lib.rs). */
export function db(): Promise<Database> {
  conn ??= Database.load("sqlite:momentum.db");
  return conn;
}
