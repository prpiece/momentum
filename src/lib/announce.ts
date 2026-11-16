/*
 * Polite screen-reader announcements for changes that show no toast (reopening a task, a keyboard
 * move). Toasts already speak through Sonner's live region, so don't announce the same thing twice.
 */
let region: HTMLElement | null = null;

export function announce(message: string) {
  if (typeof document === "undefined") return;
  if (!region?.isConnected) {
    region = document.createElement("div");
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.className = "sr-only";
    document.body.appendChild(region);
  }
  // Clearing first makes a repeated message speak again.
  region.textContent = "";
  const r = region;
  setTimeout(() => (r.textContent = message), 50);
}
