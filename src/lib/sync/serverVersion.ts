/*
 * Whether the server has the schema sharing and connections need (D289). Read once per sign-in
 * (and again while still unknown); an old server shows one message instead of failing call by call.
 */
import { create } from "zustand";
import { serverState, type ServerState } from "../../domain/serverStatus";
import { supabase } from "./supabase";

export const useServerVersion = create<{ state: ServerState }>(() => ({ state: "unknown" }));
export const serverBehind = () => useServerVersion.getState().state === "behind";
export const markServerBehind = () => useServerVersion.setState({ state: "behind" });

/** Reads `server_meta.schema_version`; a failed read (offline) leaves the state alone. */
export async function checkServerVersion(): Promise<void> {
  if (useServerVersion.getState().state === "ok") return;
  const r = await supabase.from("server_meta").select("schema_version").maybeSingle();
  const next = serverState({ data: r.data, error: r.error });
  if (next !== "unknown") useServerVersion.setState({ state: next });
}

export const resetServerVersion = () => useServerVersion.setState({ state: "unknown" });
