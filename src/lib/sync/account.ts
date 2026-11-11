/*
 * Sign-in and account actions shared by the desktop Account page and the phone (PLAN D229).
 * Each returns the message to show; the apps only draw the forms.
 */
import { deviceId, enableSync, signInSituation, wipeLocal, type SyncStatus } from "./engine";
import { supabase } from "./supabase";

export const HANDLE = /^[a-z0-9_]{3,20}$/;
export type Profile = { handle: string | null; display_name: string | null };
export type Device = { id: string; platform: string | null; last_seen: string };
export type AccountInfo = { email: string | null; profile: Profile; devices: Device[]; me: string };

/** Emails a 6-digit code. Returns an error message, or null when sent. */
export async function sendCode(email: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  return error ? `Couldn't send the code: ${error.message}` : null;
}

/**
 * Checks the code and turns sync on (D118). When this device holds another account's data,
 * `addOtherData` asks whether to add it to this account; no removes it (a backup is kept).
 */
export async function verifyCode(email: string, code: string, addOtherData: () => Promise<boolean>): Promise<{ ok: boolean; message: string }> {
  try {
    const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error || !data.user) return { ok: false, message: error ? `That code didn't work: ${error.message}` : "That code didn't work." };
    const uid = data.user.id;
    const situation = await signInSituation(uid);
    if (situation === "otherAccount" && !(await addOtherData())) await wipeLocal();
    const { counts } = await enableSync(uid, situation === "resume" ? "resume" : "fresh");
    const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
    return {
      ok: true,
      message: situation === "resume" ? "Signed in. Sync is back on." : `Signed in. Added ${counts.tasks ?? 0} tasks, ${counts.lists ?? 0} lists and ${counts.habits ?? 0} habits (${total} items) to your account.`,
    };
  } catch (err) {
    console.error(err);
    return { ok: false, message: `Sign-in failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function loadAccount(account: string): Promise<AccountInfo> {
  const [{ data: user }, { data: p }, { data: d }, me] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("handle, display_name").eq("id", account).maybeSingle(),
    supabase.from("devices").select("id, platform, last_seen").order("last_seen", { ascending: false }),
    deviceId(),
  ]);
  return { email: user.user?.email ?? null, profile: (p as Profile | null) ?? { handle: null, display_name: null }, devices: (d as Device[] | null) ?? [], me };
}

/** Saves the first handle and display name. The input field strips a typed leading @. */
export async function saveHandle(account: string, handle: string, name: string): Promise<{ ok: true; profile: Profile } | { ok: false; message: string }> {
  const h = handle.trim().toLowerCase();
  if (!HANDLE.test(h)) return { ok: false, message: h.includes("@") ? "Leave out the @: use only letters, digits and _." : "A handle is 3–20 letters, digits or _." };
  const row = { id: account, handle: h, display_name: name.trim() || h };
  const { error } = await supabase.from("profiles").upsert(row);
  if (error) return { ok: false, message: /reserved/.test(error.message) ? "That handle is reserved." : /duplicate|unique/i.test(error.message) ? "That handle is taken." : error.message };
  return { ok: true, profile: { handle: row.handle, display_name: row.display_name } };
}

export function statusText(s: SyncStatus): string {
  switch (s.kind) {
    case "off":
      return "Sync is off.";
    case "syncing":
      return "Syncing…";
    case "offline":
      return "Offline. Changes sync when you're back online.";
    case "updateRequired":
      return "Update Momentum to keep syncing. Everything still works on this device.";
    case "error":
      return `Sync failed: ${s.message}`;
    case "idle":
      return s.at ? `Synced at ${new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "Ready to sync.";
  }
}
