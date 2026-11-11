/** False when the frontend runs in a plain browser (`npm run dev`): the UI works, nothing persists. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * The SQLite connection the shared code (repos, stores, sync) talks to: Tauri's SQL plugin on
 * desktop, expo-sqlite on the phone (PLAN D229). Each app sets it once at startup with `setDriver`;
 * without one (browser preview, tests) reads return nothing and writes are dropped.
 */
export type Driver = {
  select<T>(sql: string, params?: unknown[]): Promise<T>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
};

/**
 * The shared SQL writes parameters as `$1, $2…`, which sqlx binds by number. Drivers that bind an
 * array by order of appearance (expo-sqlite) need SQLite's explicit `?1, ?2…` instead.
 */
export const numberedParams = (sql: string) => sql.replace(/\$(\d+)/g, "?$1");

let open: (() => Promise<Driver>) | undefined;
let conn: Promise<Driver> | undefined;

/** Opening the DB is what runs the migrations (Rust on desktop, `mobile/` on the phone). */
export function setDriver(opener: () => Promise<Driver>) {
  open = opener;
  conn = undefined;
}

/** True once an app has set a driver: data persists. */
export const hasDb = () => !!open;

export function db(): Promise<Driver> {
  if (!open) throw new Error("No database driver set");
  conn ??= open();
  return conn;
}

export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!open) return [];
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

type WriteListener = () => void;
const writeListeners = new Set<WriteListener>();
/** Called after every successful app write (sync schedules a push from it). */
export const onWrite = (fn: WriteListener) => {
  writeListeners.add(fn);
  return () => void writeListeners.delete(fn);
};

/** Runs `fn` on the write chain, so no app write interleaves with it (sync applies a pull this way). */
export function transact<T>(fn: (d: Driver) => Promise<T>): Promise<T> {
  const run = chain.then(async () => fn(await db()));
  chain = run.catch(() => undefined);
  return run;
}

/** Queue statements to run in order. Failures are reported to listeners (the UI shows a toast). */
export function write(...statements: [sql: string, params?: unknown[]][]): Promise<void> {
  if (!open) return Promise.resolve();
  const run = chain.then(async () => {
    const d = await db();
    for (const [sql, params] of statements) await d.execute(sql, params ?? []);
    writeListeners.forEach((fn) => fn());
  });
  chain = run.catch((err) => {
    console.error("Database write failed", err);
    errorListeners.forEach((fn) => fn(err));
  });
  return run.catch(() => undefined);
}

/** `INSERT ... ON CONFLICT(id) DO UPDATE` for every column. Never REPLACE: that would cascade-delete children. */
export function upsert(table: string, row: Record<string, unknown>, key: readonly string[] = ["id"]): [string, unknown[]] {
  const cols = Object.keys(row);
  const rest = cols.filter((c) => !key.includes(c));
  const sql =
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ` +
    `ON CONFLICT(${key.join(", ")}) DO ${rest.length ? `UPDATE SET ${rest.map((c) => `${c} = excluded.${c}`).join(", ")}` : "NOTHING"}`;
  return [sql, Object.values(row)];
}
