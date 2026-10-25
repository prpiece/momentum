import Database from "@tauri-apps/plugin-sql";

/** False when the frontend runs in a plain browser (`npm run dev`): the UI works, nothing persists. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let conn: Promise<Database> | undefined;

/** Opening the DB is what triggers the plugin's migrations (registered in src-tauri/src/lib.rs). */
export function db(): Promise<Database> {
  conn ??= Database.load("sqlite:momentum.db");
  return conn;
}

export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!isTauri) return [];
  return (await db()).select<T[]>(sql, params);
}

type WriteErrorListener = (err: unknown) => void;
const errorListeners = new Set<WriteErrorListener>();
export const onWriteError = (fn: WriteErrorListener) => {
  errorListeners.add(fn);
  return () => void errorListeners.delete(fn);
};

// Every write goes through one chain so a burst of edits lands in the order it was made.
let chain: Promise<unknown> = Promise.resolve();

/** Queue statements to run in order. Failures are reported to listeners (the UI shows a toast). */
export function write(...statements: [sql: string, params?: unknown[]][]): Promise<void> {
  if (!isTauri) return Promise.resolve();
  const run = chain.then(async () => {
    const d = await db();
    for (const [sql, params] of statements) await d.execute(sql, params ?? []);
  });
  chain = run.catch((err) => {
    console.error("Database write failed", err);
    errorListeners.forEach((fn) => fn(err));
  });
  return run.catch(() => undefined);
}

/** `INSERT ... ON CONFLICT(id) DO UPDATE` for every column. Never REPLACE: that would cascade-delete children. */
export function upsert(table: string, row: Record<string, unknown>): [string, unknown[]] {
  const cols = Object.keys(row);
  const sql =
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ` +
    `ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")}`;
  return [sql, Object.values(row)];
}
