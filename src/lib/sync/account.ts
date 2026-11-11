/*
 * Sign-in and account actions shared by the desktop Account page and the phone (PLAN D229).
 * Each returns the message to show; the apps only draw the forms.
 */
import { deviceId, enableSync, signInSituation, signOut, wipeLocal, type SyncStatus } from "./engine";
import { supabase } from "./supabase";

export const HANDLE = /^[a-z0-9_]{3,20}$/;
export type Profile = { handle: string | null; display_name: string | null };
export type Device = { id: string; platform: string | null; last_seen: string };
/** `deletesAt`: set while a deletion is pending (D231), so the app can offer to keep the account. */
export type AccountInfo = { email: string | null; profile: Profile; devices: Device[]; me: string; deletesAt: Date | null };
const GRACE_MS = 7 * 86_400_000;

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
  const [{ data: user }, { data: p }, { data: d }, { data: del }, me] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("handle, display_name").eq("id", account).maybeSingle(),
    supabase.from("devices").select("id, platform, last_seen").order("last_seen", { ascending: false }),
    supabase.from("account_deletions").select("requested_at").eq("owner_id", account).maybeSingle(),
    deviceId(),
  ]);
  const requested = (del as { requested_at: string } | null)?.requested_at;
  return {
    email: user.user?.email ?? null,
    profile: (p as Profile | null) ?? { handle: null, display_name: null },
    devices: (d as Device[] | null) ?? [],
    me,
    deletesAt: requested ? new Date(Date.parse(requested) + GRACE_MS) : null,
  };
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

/**
 * Asks the server to delete the account in 7 days (D160, D231). Every device is signed out; this
 * one keeps its data, as after a normal sign-out. Signing in again within 7 days can cancel it.
 */
export async function deleteAccount(): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error || typeof data !== "string") return { ok: false, message: `Couldn't delete your account: ${error?.message ?? "unexpected reply"}` };
  await signOut("keep");
  const when = new Date(data).toLocaleDateString([], { day: "numeric", month: "long" });
  return { ok: true, message: `Your account and everything synced to it will be deleted on ${when}. Sign in before then to keep it. This device keeps its data.` };
}

/** Keeps the account: withdraws a pending deletion. Returns an error message, or null. */
export async function keepAccount(account: string): Promise<string | null> {
  const { error } = await supabase.from("account_deletions").delete().eq("owner_id", account);
  return error ? `Couldn't keep your account: ${error.message}` : null;
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
