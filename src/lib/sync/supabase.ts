/*
 * The Supabase client. Sessions live in memory; only the refresh token is kept, in the device's
 * secure store (v1.1 spec, "Token storage"), and a new launch trades it for a fresh session.
 * Each app calls `configureSync` once at startup (PLAN D229): desktop with its Vite env and the OS
 * keychain, the phone with Expo's env and expo-secure-store. Until then sync is off.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Where the refresh token lives: one key, so the store can't be used for anything else. */
export type SecretStore = {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
};

const memory = new Map<string, string>();
const make = (url: string, key: string) =>
  createClient(url, key, {
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

/** False until an app configures a project: the Account page then explains sync is unavailable. */
export let syncConfigured = false;
export let supabase: SupabaseClient = make("http://127.0.0.1:54321", "unset");
let secrets: SecretStore | null = null;
let stored: string | null = null;

export function configureSync(url: string | undefined, key: string | undefined, store: SecretStore) {
  if (!url || !key) return;
  supabase = make(url, key);
  secrets = store;
  syncConfigured = true;
  // Keep the secure store in step with the session: a refresh rotates the token, sign-out removes it.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      stored = null;
      void store.delete().catch((e) => console.error("Secure store delete failed", e));
    } else if (session?.refresh_token && session.refresh_token !== stored) {
      stored = session.refresh_token;
      void store.set(session.refresh_token).catch((e) => console.error("Secure store write failed", e));
    }
  });
}

/**
 * Signs back in from the stored refresh token. `ended`: there's no token or the server
 * rejected it (revoked, signed out everywhere), so the device must sign in again. `offline`: try later.
 */
export async function restoreSession(): Promise<"ok" | "ended" | "offline"> {
  if (!secrets) return "ended";
  let token: string | null;
  try {
    token = await secrets.get();
  } catch (e) {
    // A secure-store hiccup must not sign the user out: try again later.
    console.error("Secure store read failed", e);
    return "offline";
  }
  if (!token) return "ended";
  stored = token;
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: token });
  if (error) {
    // Revoked or expired for good: forget it. A network error keeps it for the next launch.
    if (!error.status || error.status >= 500) return "offline";
    await secrets.delete().catch(() => undefined);
    return "ended";
  }
  return data.session ? "ok" : "ended";
}
