/*
 * What the app learns about the server it talks to (D289): whether it has the schema that sharing
 * and connections need, and how to word a failed server call. Pure.
 */

/** The `server_meta.schema_version` this app needs for friends, shares and connections. Every server migration bumps it. */
export const SERVER_SCHEMA_NEEDED = 1;
export const SERVER_UPDATE_MESSAGE = "Sharing and connections need a server update";

export type ServerState = "unknown" | "ok" | "behind";
type PgError = { code?: string; message?: string } | null;

/**
 * Reads the answer to `select schema_version from server_meta`. A server without the column, or with
 * no number in it, is behind. Any other error (offline, signed out) says nothing, so it stays "unknown".
 */
export function serverState(r: { data: unknown; error: PgError }): ServerState {
  if (r.error) return r.error.code === "42703" || r.error.code === "PGRST204" ? "behind" : "unknown";
  if (typeof r.data !== "object" || r.data === null) return "unknown";
  const v = (r.data as { schema_version?: unknown }).schema_version;
  return typeof v === "number" && v >= SERVER_SCHEMA_NEEDED ? "ok" : "behind";
}

/** A function the app calls that the server doesn't have: the server predates it. */
export const isMissingFunction = (e: PgError) => e?.code === "PGRST202" || e?.code === "42883";

/** "Couldn't <what>." plus the reason when there's one worth showing, so a toast says what failed. */
export function failureText(what: string, e: { message?: string } | null): string {
  const m = e?.message ?? "";
  if (/failed to fetch|network|load failed|timeout/i.test(m)) return `Couldn't ${what}. Check your connection and try again.`;
  return `Couldn't ${what}. Try again.`;
}
