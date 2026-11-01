import { useEffect, useState } from "react";
import { create } from "zustand";
import { isTauri } from "../db/client";
import type { Update } from "@tauri-apps/plugin-updater";
import { toast } from "../stores/ui";
import { changelogSection } from "../domain/changelog";
import changelog from "../../CHANGELOG.md?raw";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; version: string; /** 0..1, or null before the size is known */ progress: number | null }
  | { kind: "error"; message: string };

const CHECKED_KEY = "momentum:update-checked";
/** Written by v0.4.0 before installing an update; read once so that update still gets its "What's new". */
const LEGACY_WHATS_NEW_KEY = "momentum:whats-new";
const SEEN_KEY = "momentum:seen-version";

const readChecked = () => {
  try {
    return localStorage.getItem(CHECKED_KEY);
  } catch {
    return null;
  }
};

/** Settings → Updates reads this. `prompt` opens the update dialog when the launch check finds a release. */
export const useUpdate = create<{ status: UpdateStatus; checkedAt: string | null; prompt: boolean }>(() => ({ status: { kind: "idle" }, checkedAt: readChecked(), prompt: false }));
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
    if (!manual) set({ prompt: true });
  } catch (err) {
    console.error("Update check failed", err);
    set({ status: { kind: "error", message: "Couldn't reach GitHub to check for updates." } });
    if (manual) toast("Couldn't reach GitHub to check for updates.");
  }
}

export const dismissUpdatePrompt = () => set({ prompt: false });

/** Downloads, installs and restarts. The new version's own CHANGELOG.md has the "What's new". */
export async function installUpdate() {
  const update = pending;
  if (!update) return;
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

/**
 * The running version's CHANGELOG.md section, once, when it differs from the version seen last time.
 * A fresh install just records its version.
 */
export function takeWhatsNew(currentVersion: string): string | null {
  try {
    const seen = localStorage.getItem(SEEN_KEY);
    const legacy = localStorage.getItem(LEGACY_WHATS_NEW_KEY);
    localStorage.setItem(SEEN_KEY, currentVersion);
    localStorage.removeItem(LEGACY_WHATS_NEW_KEY);
    const updated = (seen !== null && seen !== currentVersion) || legacy !== null;
    return updated ? changelogSection(changelog, currentVersion) : null;
  } catch {
    return null;
  }
}
