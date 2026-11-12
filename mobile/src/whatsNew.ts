import Constants from "expo-constants";
import { select, write } from "@core/db/client";
import { missedSections } from "@core/domain/changelog";
import { CHANGELOG } from "./changelog";

export const appVersion = Constants.expoConfig?.version ?? "0.0.0";

/** Sections to show for this app version, or null when `seen` is current. */
export const sectionsSince = (seen: string | null) => missedSections(CHANGELOG, seen, appVersion);

/**
 * Once, after an update: the version seen last lives in sync_state (device-local, not synced). A fresh
 * install just records its version, as on the desktop (D98). Returns the version seen last when What's new should open, else null.
 */
export async function updatedSinceLastRun(): Promise<string | null> {
  const rows = await select<{ value: string }>("SELECT value FROM sync_state WHERE key = 'seen_version'");
  const seen = rows[0]?.value ?? null;
  if (seen === appVersion) return null;
  await write(["INSERT INTO sync_state (key, value) VALUES ('seen_version', $1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [appVersion]]);
  return seen !== null && sectionsSince(seen).length > 0 ? seen : null;
}
