import * as SQLite from "expo-sqlite";
import { numberedParams, type Driver } from "@core/db/client";
import { MIGRATIONS } from "./migrations";

let path = "";
/** The database file's location, for snapshots next to it. */
export const databasePath = () => path;

/**
 * Opens momentum.db and brings it to the desktop's schema by running the same migration files
 * (PLAN D229), each in one transaction, tracked with `PRAGMA user_version`.
 */
export async function openDatabase(): Promise<Driver> {
  const db = await SQLite.openDatabaseAsync("momentum.db");
  path = db.databasePath;
  // Desktop's sqlx turns foreign keys on; deletes rely on their cascades.
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const current = (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;
  for (const m of MIGRATIONS.filter((m) => m.version > current)) {
    try {
      await db.execAsync(`BEGIN;\n${m.sql}\n;\nPRAGMA user_version = ${m.version};\nCOMMIT;`);
    } catch (err) {
      await db.execAsync("ROLLBACK;").catch(() => undefined);
      throw new Error(`Migration ${m.version} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    // The Driver interface is generic over the row type; SQLite rows are untyped records.
    select: <T,>(sql: string, params: unknown[] = []) => db.getAllAsync(numberedParams(sql), params as SQLite.SQLiteBindValue[]) as Promise<T>,
    execute: async (sql, params = []) => ({ rowsAffected: (await db.runAsync(numberedParams(sql), params as SQLite.SQLiteBindValue[])).changes }),
  };
}
