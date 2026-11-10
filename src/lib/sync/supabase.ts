/*
 * The Supabase client. Sessions live in memory; only the refresh token is kept, in the OS
 * keychain (v1.1 spec, "Token storage"), and a new launch trades it for a fresh session.
 * Point the app at a local server with VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY in `.env.local`.
 */
import { createClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../db/client";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
/** False in builds without a configured project: the Account page then explains sync is unavailable. */
export const syncConfigured = !!url && !!key && isTauri;

const memory = new Map<string, string>();
export const supabase = createClient(url ?? "http://127.0.0.1:54321", key ?? "unset", {
  auth: {
    storage: {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    },
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
});

const TOKEN = "refresh_token";
let stored: string | null = null;

// Keep the keychain in step with the session: a refresh rotates the token, sign-out removes it.
supabase.auth.onAuthStateChange((event, session) => {
  if (!syncConfigured) return;
  if (event === "SIGNED_OUT") {
    stored = null;
    void invoke("secret_delete", { key: TOKEN }).catch((e) => console.error("Keychain delete failed", e));
  } else if (session?.refresh_token && session.refresh_token !== stored) {
    stored = session.refresh_token;
    void invoke("secret_set", { key: TOKEN, value: session.refresh_token }).catch((e) => console.error("Keychain write failed", e));
  }
});

/**
 * Signs back in from the keychain's refresh token. `ended`: there's no token or the server
 * rejected it (revoked, signed out everywhere), so the device must sign in again. `offline`: try later.
 */
export async function restoreSession(): Promise<"ok" | "ended" | "offline"> {
  if (!syncConfigured) return "ended";
  let token: string | null;
  try {
    token = await invoke<string | null>("secret_get", { key: TOKEN });
  } catch (e) {
    // A keychain hiccup must not sign the user out: try again later.
    console.error("Keychain read failed", e);
    return "offline";
  }
  if (!token) return "ended";
  stored = token;
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: token });
  if (error) {
    // Revoked or expired for good: forget it. A network error keeps it for the next launch.
    if (!error.status || error.status >= 500) return "offline";
    await invoke("secret_delete", { key: TOKEN }).catch(() => undefined);
    return "ended";
  }
  return data.session ? "ok" : "ended";
}
