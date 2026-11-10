import { isTauri } from "../db/client";

/** Public pages (PLAN D186); the app may open only these (opener scope in capabilities/default.json). */
export const SITE = "https://prpiece.github.io/momentum/";
export type SitePage = "terms.html" | "privacy.html";

/** Opens a public page in the system browser. */
export async function openSite(page: SitePage) {
  const url = SITE + page;
  if (!isTauri) return void window.open(url, "_blank", "noopener");
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
