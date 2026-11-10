import { DEFAULT_SETTINGS, parseSettings, userSettingsPatch } from "../domain/settings";
import type { Settings } from "../domain/types";
import { select, write } from "./client";

/** What the database holds now, so a save can tell which user settings changed (they sync, D225). */
let saved: Settings = DEFAULT_SETTINGS;

export async function loadSettings(): Promise<Settings> {
  const rows = await select<{ value: string }>("SELECT value FROM settings WHERE id = 1");
  if (!rows[0]) return (saved = DEFAULT_SETTINGS);
  try {
    return (saved = parseSettings(JSON.parse(rows[0].value)));
  } catch (err) {
    console.error("Stored settings are not valid JSON; using defaults", err);
    return (saved = DEFAULT_SETTINGS);
  }
}

/** `record`: false when the change came from sync itself and must not be sent back. */
export function saveSettings(s: Settings, record = true): Promise<void> {
  const patch = userSettingsPatch(saved, s);
  saved = s;
  return write(
    ["INSERT INTO settings (id, value) VALUES (1, $1) ON CONFLICT(id) DO UPDATE SET value = excluded.value", [JSON.stringify(s)]],
    ...(record && Object.keys(patch).length
      ? [
          [
            `INSERT INTO sync_outbox (tbl, row_id, fields, created_at)
             SELECT 'settings', 'user', $1, $2 WHERE (SELECT value FROM sync_state WHERE key = 'record') = '1'`,
            [JSON.stringify(patch), new Date().toISOString()],
          ] as [string, unknown[]],
        ]
      : []),
  );
}
