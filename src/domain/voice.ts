import { isRecord } from "./settings";

/** A fixed spoken phrase that controls the app instead of becoming a task (GLOSSARY: Voice command). */
export type VoiceCommand = "startFocus" | "stopFocus" | "openToday" | "openMatrix" | "openCalendar";

const FILLERS = new Set(["um", "uh", "er", "erm", "hmm", "please", "hey", "ok", "okay", "momentum", "can", "could", "would", "you", "the", "my", "a", "an", "now", "me", "to", "lets", "let", "us", "i", "want", "session", "view", "page", "eisenhower", "and", "just", "up"]);
const OPEN = new Set(["open", "show", "go", "switch"]);
const START = new Set(["start", "begin"]);
const STOP = new Set(["stop", "end", "finish"]);
const TIMER = new Set(["focus", "focusing", "timer", "pomodoro"]);
const VIEWS: Record<string, VoiceCommand> = { today: "openToday", matrix: "openMatrix", calendar: "openCalendar" };

/**
 * The command a transcript asks for, or null when it is task text. Punctuation, case and filler
 * words are ignored; anything else left over ("start focus on chemistry") makes it a task.
 */
export function matchVoiceCommand(text: string): VoiceCommand | null {
  const words = text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z]+/)
    .filter((w) => w && !FILLERS.has(w));
  if (words.length !== 2) return null;
  const [verb, noun] = words;
  if (OPEN.has(verb) && noun in VIEWS) return VIEWS[noun];
  if (TIMER.has(noun)) return START.has(verb) ? "startFocus" : STOP.has(verb) ? "stopFocus" : null;
  return null;
}

/** Settings → Voice. Mirrors `ModelStatus` in src-tauri/src/voice.rs. */
export type ModelStatus =
  | { state: "missing" }
  | { state: "downloading"; received: number; total: number }
  | { state: "verifying" }
  | { state: "ready" }
  | { state: "error"; message: string };

/** Boundary check for what Rust sends; anything unexpected reads as an error, not a crash. */
export function parseModelStatus(raw: unknown): ModelStatus {
  if (!isRecord(raw)) return { state: "error", message: "Unknown voice model status" };
  switch (raw.state) {
    case "missing":
    case "verifying":
    case "ready":
      return { state: raw.state };
    case "downloading":
      if (typeof raw.received === "number" && typeof raw.total === "number") return { state: "downloading", received: raw.received, total: raw.total };
      break;
    case "error":
      if (typeof raw.message === "string") return { state: "error", message: raw.message };
  }
  return { state: "error", message: "Unknown voice model status" };
}

/** What the main window tells the quick-add popup during voice quick-add. */
export type VoicePopupEvent = { kind: "listening" } | { kind: "transcribing" } | { kind: "text"; text: string } | { kind: "error"; message: string } | { kind: "close" };
