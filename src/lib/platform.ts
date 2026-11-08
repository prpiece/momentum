import { macKeys } from "../domain/keys";

export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

/** A shortcut as written for Windows/Linux ("Ctrl K"), spelled for this computer. */
export const keyLabel = (keys: string) => (isMac ? macKeys(keys) : keys);

/** Where the app keeps its data, for the Settings text (the folder name is the bundle identifier). */
export const dataDirLabel = isMac ? "~/Library/Application Support/com.momentum.planner" : typeof navigator !== "undefined" && /Linux/.test(navigator.userAgent) ? "~/.config/com.momentum.planner" : "%APPDATA%\\com.momentum.planner";
