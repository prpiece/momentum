import { create } from "zustand";
import { isTauri } from "../db/client";
import { parseModelStatus, type ModelStatus } from "../domain/voice";
import { go } from "../stores/ui";

/** The voice model download (D81); Rust does the work and reports through `voice:model`. */
export const MODEL_DOWNLOAD_MB = 482;
export const MODEL_DISK_MB = 660;

export const useVoiceModel = create<{ status: ModelStatus }>(() => ({ status: { state: "missing" } }));
const setStatus = (raw: unknown) => useVoiceModel.setState({ status: parseModelStatus(raw) });

const invoke = async <T>(cmd: string) => (await import("@tauri-apps/api/core")).invoke<T>(cmd);
const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong");

let watching = false;
/** Current status from disk, and live updates from then on. */
export async function refreshVoiceModel(): Promise<ModelStatus> {
  if (!isTauri) return useVoiceModel.getState().status;
  if (!watching) {
    watching = true;
    const { listen } = await import("@tauri-apps/api/event");
    await listen("voice:model", (e) => setStatus(e.payload));
  }
  setStatus(await invoke("voice_model_status"));
  return useVoiceModel.getState().status;
}

/** Failures arrive as the `error` status; the rejection itself carries nothing more. */
export const downloadVoiceModel = () => void invoke("voice_download").catch(() => undefined);
export const cancelVoiceModelDownload = () => void invoke("voice_cancel_download");
export const removeVoiceModel = () => invoke("voice_remove").catch((e) => setStatus({ state: "error", message: errorText(e) }));

export const VOICE_SECTION_ID = "settings-voice";
/** Where the hotkey and mic button lead while the model isn't installed. */
export function openVoiceSettings() {
  go("settings");
  setTimeout(() => document.getElementById(VOICE_SECTION_ID)?.scrollIntoView({ block: "start" }), 50);
}

export const voiceStart = () => invoke<void>("voice_start");
export const voiceStop = () => invoke<string>("voice_stop");
export const voiceCancel = () => void invoke("voice_cancel");
export { errorText as voiceErrorText };
