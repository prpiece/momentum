import { bestName } from "./fuzzy";
import { isRecord } from "./settings";

/** The screens a voice command can open by name. */
export type VoiceView = "inbox" | "today" | "upcoming" | "calendar" | "habits" | "focus" | "progress" | "settings";
export type FocusOp = "start" | "stop" | "pause" | "resume" | "skip" | "break";

/** A fixed spoken phrase that controls the app instead of becoming a task (GLOSSARY: Voice command). */
export type VoiceCommand =
  | { kind: "view"; view: VoiceView }
  /** Switch the current task view to Matrix mode (D175). */
  | { kind: "matrix" }
  /** Turn on Show completed in the current task view (replaces opening the Logbook). */
  | { kind: "showCompleted" }
  | { kind: "openList"; name: string }
  | { kind: "focus"; op: FocusOp }
  | { kind: "mini"; open: boolean }
  /** `query` still has to be matched against open tasks by the main window, which owns the data. */
  | { kind: "complete"; query: string };

const FILLERS = new Set(["um", "uh", "er", "erm", "hmm", "please", "hey", "ok", "okay", "momentum", "can", "could", "would", "you", "the", "my", "a", "an", "now", "me", "to", "lets", "let", "us", "i", "want", "session", "view", "page", "eisenhower", "and", "just", "up"]);
const OPEN = new Set(["open", "show", "go", "switch"]);
const CLOSE = new Set(["close", "hide", "dismiss"]);
const START = new Set(["start", "begin"]);
const STOP = new Set(["stop", "end", "finish"]);
const TIMER = new Set(["focus", "focusing", "timer", "pomodoro"]);
const COMPLETE = new Set(["complete", "completed", "done", "finish", "finished"]);
const VIEWS: Record<string, VoiceView> = {
  inbox: "inbox",
  today: "today",
  upcoming: "upcoming",
  calendar: "calendar",
  habits: "habits",
  habit: "habits",
  focus: "focus",
  stats: "progress",
  statistics: "progress",
  progress: "progress",
  settings: "settings",
  countdown: "calendar",
  countdowns: "calendar",
};
const COMPLETED = new Set(["logbook", "completed", "done tasks", "completed tasks", "finished tasks"]);

function focusCommand(verb: string, noun: string): VoiceCommand | null {
  if (noun === "break") return START.has(verb) || verb === "take" ? { kind: "focus", op: "break" } : verb === "skip" ? { kind: "focus", op: "skip" } : null;
  if (!TIMER.has(noun) && !(verb === "skip" && noun === "phase")) return null;
  if (START.has(verb)) return { kind: "focus", op: "start" };
  if (STOP.has(verb)) return { kind: "focus", op: "stop" };
  if (verb === "pause") return { kind: "focus", op: "pause" };
  if (verb === "resume" || verb === "continue") return { kind: "focus", op: "resume" };
  return verb === "skip" ? { kind: "focus", op: "skip" } : null;
}

/**
 * The command a transcript asks for, or null when it is task text. Punctuation, case and filler
 * words are ignored; anything else left over ("start focus on chemistry") makes it a task.
 * `listNames` lets "open <list>" match an existing list, fuzzily (D94, D95).
 */
export function matchVoiceCommand(text: string, listNames: readonly string[] = []): VoiceCommand | null {
  const words = text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLERS.has(w));
  if (words[words.length - 1] === "window" && words[words.length - 2] === "mini") words.pop();
  if (words.length < 2) return null;
  const [verb, ...rest] = words;
  if (OPEN.has(verb) && rest.join(" ") === "matrix") return { kind: "matrix" };
  if (OPEN.has(verb) && COMPLETED.has(rest.join(" "))) return { kind: "showCompleted" };
  if (rest.length === 1) {
    const noun = rest[0];
    if (OPEN.has(verb) && noun in VIEWS) return { kind: "view", view: VIEWS[noun] };
    if (noun === "mini" && (OPEN.has(verb) || CLOSE.has(verb))) return { kind: "mini", open: OPEN.has(verb) };
    const f = focusCommand(verb, noun);
    if (f) return f;
  }
  // "complete X", "done with X", "mark X (as) done", "tick off X"
  const task =
    COMPLETE.has(verb) ? rest[0] === "with" ? rest.slice(1) : rest
    : verb === "mark" && rest[rest.length - 1] === "done" ? rest.slice(0, rest[rest.length - 2] === "as" ? -2 : -1)
    : verb === "tick" && rest[0] === "off" ? rest.slice(1)
    : [];
  if (task.length) return { kind: "complete", query: task.join(" ") };
  const name = OPEN.has(verb) ? bestName(rest.join(" "), listNames) : null;
  return name ? { kind: "openList", name } : null;
}

const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/**
 * Cleans common recognizer spellings before parsing or matching (D94): "five p m" and "5 p.m." become
 * "5pm", and "tag to do" becomes "tag todo".
 */
// ponytail: only whole hours/times with a digit or one..twelve; "nine thirty a m" is left as spoken.
export function normalizeTranscript(text: string): string {
  return text
    .replace(/\b(\d{1,2}(?::\d{2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*([ap])\.?\s?m\b\.?/gi, (_, n: string, ap: string) => {
      const i = NUMBER_WORDS.indexOf(n.toLowerCase());
      return `${i >= 0 ? i + 1 : n}${ap.toLowerCase()}m`;
    })
    // Only after "tag"/"list": elsewhere "to do" is usually the verb ("I have to do laundry").
    .replace(/\b(tag|list)\s+to[\s-]do\b/gi, "$1 todo");
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

/** An open task offered for confirmation in the popup (D95). */
export type CompleteCandidate = { id: string; title: string };

/**
 * What the main window tells the quick-add popup during voice quick-add. `confirm` asks before a
 * spoken "complete …" is applied; `text` is the original transcript, restored if the user backs out.
 */
export type VoicePopupEvent =
  | { kind: "listening" }
  | { kind: "transcribing" }
  | { kind: "text"; text: string }
  | { kind: "confirm"; text: string; candidates: CompleteCandidate[] }
  | { kind: "error"; message: string }
  | { kind: "close" };

/** Boundary check for `quickadd:voice` payloads in the popup. */
export function parseVoicePopupEvent(raw: unknown): VoicePopupEvent | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case "listening":
    case "transcribing":
    case "close":
      return { kind: raw.kind };
    case "text":
      return typeof raw.text === "string" ? { kind: "text", text: raw.text } : null;
    case "error":
      return typeof raw.message === "string" ? { kind: "error", message: raw.message } : null;
    case "confirm": {
      if (typeof raw.text !== "string" || !Array.isArray(raw.candidates)) return null;
      const candidates = raw.candidates.flatMap((c): CompleteCandidate[] => (isRecord(c) && typeof c.id === "string" && typeof c.title === "string" ? [{ id: c.id, title: c.title }] : []));
      return candidates.length && candidates.length === raw.candidates.length ? { kind: "confirm", text: raw.text, candidates } : null;
    }
    default:
      return null;
  }
}
