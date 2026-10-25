import { DEFAULT_SETTINGS, parseSettings } from "../domain/settings";
import type { Settings } from "../domain/types";
import { db, isTauri } from "./client";

export async function loadSettings(): Promise<Settings> {
  if (!isTauri) return DEFAULT_SETTINGS;
  const rows = await (await db()).select<{ value: string }[]>("SELECT value FROM settings WHERE id = 1");
  if (!rows[0]) return DEFAULT_SETTINGS;
  try {
    return parseSettings(JSON.parse(rows[0].value));
  } catch (err) {
    console.error("Stored settings are not valid JSON; using defaults", err);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  if (!isTauri) return;
  await (await db()).execute(
    "INSERT INTO settings (id, value) VALUES (1, $1) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    [JSON.stringify(s)],
  );
}
