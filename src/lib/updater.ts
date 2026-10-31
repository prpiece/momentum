import { isTauri } from "../db/client";
import { toast } from "../stores/ui";

/**
 * Looks for a signed release on GitHub (D59): the app's only network call.
 * `manual` also reports "up to date" and failures; the launch check stays quiet unless there's news.
 */
export async function checkForUpdate(manual = false) {
  if (!isTauri) return manual && toast("Updates come through the desktop app.");
  try {
    const [{ check }, { relaunch }] = await Promise.all([import("@tauri-apps/plugin-updater"), import("@tauri-apps/plugin-process")]);
    const update = await check();
    if (!update) return manual && toast("Momentum is up to date.");
    const install = async () => {
      toast(`Downloading Momentum ${update.version}…`);
      try {
        await update.downloadAndInstall();
        await relaunch();
      } catch (err) {
        console.error("Update install failed", err);
        toast("The update couldn't be installed. Try again later.");
      }
    };
    toast(`Momentum ${update.version} is available.`, { label: "Update and restart", run: () => void install() }, 30_000);
  } catch (err) {
    console.error("Update check failed", err);
    if (manual) toast("Couldn't reach GitHub to check for updates.");
  }
}
