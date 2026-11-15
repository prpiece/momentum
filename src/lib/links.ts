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

/** The URL if it is plain http(s); anything else (javascript:, file:, custom schemes) is refused (RUST-01). */
export function webUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Sends clicks on external links (notes, What's new, update notes) to the system browser instead of navigating the app window. */
export function installLinkGuard() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
    const href = a?.getAttribute("href");
    if (!a || !href || href.startsWith("#")) return;
    e.preventDefault();
    const url = webUrl(a.href);
    if (!url) return;
    if (!isTauri) return void window.open(url, "_blank", "noopener");
    void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url)).catch(() => {});
  });
}
