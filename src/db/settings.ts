import { DEFAULT_SETTINGS, parseSettings } from "../domain/settings";
import type { Settings } from "../domain/types";
import { select, write } from "./client";

export async function loadSettings(): Promise<Settings> {
  const rows = await select<{ value: string }>("SELECT value FROM settings WHERE id = 1");
  if (!rows[0]) return DEFAULT_SETTINGS;
  try {
    return parseSettings(JSON.parse(rows[0].value));
  } catch (err) {
    console.error("Stored settings are not valid JSON; using defaults", err);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): Promise<void> {
  return write([
    "INSERT INTO settings (id, value) VALUES (1, $1) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    [JSON.stringify(s)],
  ]);
}
