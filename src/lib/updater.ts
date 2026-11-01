import { useEffect, useState } from "react";
import { create } from "zustand";
import { isTauri } from "../db/client";
import type { Update } from "@tauri-apps/plugin-updater";
import { toast } from "../stores/ui";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; version: string; /** 0..1, or null before the size is known */ progress: number | null }
  | { kind: "error"; message: string };

const CHECKED_KEY = "momentum:update-checked";
const WHATS_NEW_KEY = "momentum:whats-new";

const readChecked = () => {
  try {
    return localStorage.getItem(CHECKED_KEY);
  } catch {
    return null;
  }
};

/** Settings → Updates reads this; the launch check also toasts when there's news. */
export const useUpdate = create<{ status: UpdateStatus; checkedAt: string | null }>(() => ({ status: { kind: "idle" }, checkedAt: readChecked() }));
const set = useUpdate.setState;

/** The release notes above the "---" line: the CHANGELOG.md section (D66). The rest is install help. */
export const releaseNotes = (body: string | undefined) => (body ?? "").split(/\n-{3,}\n/)[0].trim();

let pending: Update | null = null;

/**
 * Looks for a signed release on GitHub (D59): the app's only network call.
 * `manual` also reports "up to date" and failures; the launch check stays quiet unless there's news.
 */
export async function checkForUpdate(manual = false) {
  if (!isTauri) {
    set({ status: { kind: "error", message: "Updates come through the desktop app." } });
    return;
  }
  set({ status: { kind: "checking" } });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    const now = new Date().toISOString();
    try {
      localStorage.setItem(CHECKED_KEY, now);
    } catch {
      // Storage unavailable: the "last checked" line just won't survive a restart.
    }
    set({ checkedAt: now });
    if (!update) {
      set({ status: { kind: "current" } });
      if (manual) toast("Momentum is up to date.");
      return;
    }
    pending = update;
    set({ status: { kind: "available", version: update.version, notes: releaseNotes(update.body) } });
    if (!manual) toast(`Momentum ${update.version} is available.`, { label: "Update and restart", run: () => void installUpdate() }, 30_000);
  } catch (err) {
    console.error("Update check failed", err);
    set({ status: { kind: "error", message: "Couldn't reach GitHub to check for updates." } });
    if (manual) toast("Couldn't reach GitHub to check for updates.");
  }
}

/** Downloads, installs and restarts. The notes are kept for the "What's new" card after the restart. */
export async function installUpdate() {
  const update = pending;
  if (!update) return;
  try {
    localStorage.setItem(WHATS_NEW_KEY, JSON.stringify({ version: update.version, notes: releaseNotes(update.body) }));
  } catch {
    // No "What's new" card then; the update itself still installs.
  }
  let total = 0;
  let got = 0;
  set({ status: { kind: "downloading", version: update.version, progress: null } });
  try {
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      if (e.event === "Progress") got += e.data.chunkLength;
      set({ status: { kind: "downloading", version: update.version, progress: e.event === "Finished" ? 1 : total ? got / total : null } });
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    console.error("Update install failed", err);
    set({ status: { kind: "error", message: "The update couldn't be installed. Try again later." } });
    toast("The update couldn't be installed. Try again later.");
  }
}

/** The running app's version; null in the browser build. */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setVersion));
  }, []);
  return version;
}

/** The notes saved before the last update, once, if that version is the one now running. */
export function takeWhatsNew(currentVersion: string): { version: string; notes: string } | null {
  try {
    const raw = localStorage.getItem(WHATS_NEW_KEY);
    if (!raw) return null;
    localStorage.removeItem(WHATS_NEW_KEY);
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || !("version" in v) || !("notes" in v)) return null;
    const { version, notes } = v;
    return typeof version === "string" && typeof notes === "string" && version === currentVersion && notes ? { version, notes } : null;
  } catch {
    return null;
  }
}
