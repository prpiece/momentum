import { CalendarDays, Flag, Hash, List, Mic, Plus, Repeat } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTime, relativeDayLabel, todayLocal } from "../domain/dates";
import { parseQuickAdd, withoutToken, withToken, type ChipKind } from "../domain/quickAdd";
import { contextLabel, type QuickAddContext } from "../domain/quickAddContext";
import { describeRule } from "../domain/recurrence";
import { PRIORITY_LABEL } from "../domain/types";
import { apply, readAppearance } from "../lib/applySettings";
import type { VoicePopupEvent } from "../domain/voice";
import { TokenPicker } from "./TokenPicker";

/** Voice quick-add as the popup sees it; the main window drives it with `quickadd:voice` (D81). */
type VoicePhase = { kind: "idle" } | { kind: "listening" } | { kind: "transcribing" } | { kind: "error"; message: string };

const PRIORITY_OPTIONS = [{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }];
const nameKey = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const ICON: Record<ChipKind, typeof Flag> = { date: CalendarDays, priority: Flag, tag: Hash, list: List, repeat: Repeat };

/**
 * The small always-on-top window behind the global shortcut. It has no database access: it
 * parses for preview only and hands the text to the main window, which creates the task.
 */
export function QuickAddWindow() {
  const [text, setText] = useState("");
  const [raw, setRaw] = useState(false);
  /** D90: any voice text makes the entry spoken until the input is emptied or the popup closes. */
  const [spoken, setSpoken] = useState(false);
  const [context, setContext] = useState<QuickAddContext | null>(null);
  const [lists, setLists] = useState<string[]>([]);
  const [appearance, setAppearance] = useState(readAppearance);
  const [voice, setVoice] = useState<VoicePhase>({ kind: "idle" });
  const [level, setLevel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const smart = appearance?.smartParse ?? true;
  const parsed = useMemo(() => parseQuickAdd(text, new Date(), smart && !raw, lists, spoken ? "spoken" : "typed"), [text, smart, raw, lists, spoken]);
  const parsing = smart && !raw;
  /** Tap-to-set (D89): edits the text, so the main window still parses one source of truth. */
  const chipsOf = (t: string) => parseQuickAdd(t, new Date(), true, lists, spoken ? "spoken" : "typed").chips;
  const setToken = (kind: "priority" | "list", token: string) => setText((t) => withToken(t, chipsOf(t), kind, token));
  /** D91: "None" in a filled chip's picker removes the token. */
  const clearToken = (kind: "priority" | "list") => setText((t) => withoutToken(t, chipsOf(t), kind));

  useEffect(() => {
    if (!text) setSpoken(false);
  }, [text]);

  useEffect(() => {
    if (appearance) apply(appearance);
    const onStorage = () => setAppearance(readAppearance());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [appearance]);

  useEffect(() => {
    let off: (() => void)[] = [];
    let disposed = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      off = [
        await listen<{ context: QuickAddContext | null; lists: unknown }>("quickadd:focus", (e) => {
          setContext(e.payload.context);
          // Boundary: only strings become list names.
          setLists(Array.isArray(e.payload.lists) ? e.payload.lists.filter((n): n is string => typeof n === "string") : []);
          setAppearance(readAppearance());
          input.current?.focus();
          input.current?.select();
        }),
        await listen<VoicePopupEvent>("quickadd:voice", (e) => {
          const v = e.payload;
          if (v.kind === "close") return void close();
          if (v.kind === "text") {
            setText((t) => (t.trim() ? `${t.trimEnd()} ${v.text}` : v.text));
            setSpoken(true);
            setVoice({ kind: "idle" });
          } else setVoice(v);
          if (v.kind === "listening") setLevel(0);
          input.current?.focus();
        }),
        await listen<number>("voice:level", (e) => setLevel(e.payload)),
        await w.onFocusChanged(({ payload }) => {
          if (!payload) void hide();
        }),
      ];
      // Unmounted while registering (StrictMode's double mount): don't leave duplicate listeners.
      if (disposed) off.forEach((f) => f());
    })();
    return () => {
      disposed = true;
      off.forEach((f) => f());
    };
  }, []);

  /** D91: closing any way drops the text, chips and spoken flag, so the next open starts empty. */
  const close = async () => {
    setText("");
    setRaw(false);
    setContext(null);
    setVoice({ kind: "idle" });
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  };
  /** Closing also drops a recording in progress (the main window ignores it otherwise). */
  const hide = async () => {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("voice:cancel");
    await close();
  };
  const toggleVoice = async () => {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("voice:toggle");
  };
  const busy = voice.kind === "listening" || voice.kind === "transcribing";
  const submit = async () => {
    if (!text.trim()) return;
    const { emit } = await import("@tauri-apps/api/event");
    await emit("quickadd:create", { text, raw, context, spoken });
    await hide();
  };

  const today = todayLocal();
  const label = (kind: ChipKind, chipText: string) => {
    const s = parsed.schedule;
    if (kind === "date" && s.kind === "day") return relativeDayLabel(s.date, today);
    if (kind === "date" && s.kind === "timed") return `${relativeDayLabel(todayLocal(new Date(s.start)), today)} ${formatTime(new Date(s.start), appearance?.timeFormat ?? "24h")}`;
    if (kind === "priority" && parsed.priority !== null) return PRIORITY_LABEL[parsed.priority];
    if (kind === "repeat" && parsed.rule) return describeRule(parsed.rule);
    if (kind === "list" && parsed.listName) return lists.find((n) => nameKey(n) === nameKey(parsed.listName ?? "")) ?? parsed.listName;
    return chipText;
  };
  const picker = (kind: "priority" | "list", filled: string | null) => (
    <TokenPicker
      key={kind}
      icon={ICON[kind]}
      ariaLabel={kind === "priority" ? "Priority" : "List"}
      empty={kind === "priority" ? "+ Priority" : "+ List"}
      options={kind === "priority" ? PRIORITY_OPTIONS : lists.map((n) => ({ value: n, label: n }))}
      filled={filled}
      onPick={(v) => setToken(kind, kind === "priority" ? `!${v}` : `~${v.replace(/\s+/g, "")}`)}
      onClear={() => clearToken(kind)}
      onDone={() => input.current?.focus()}
    />
  );
  return (
    <div className="flex h-full flex-col justify-center border border-border bg-surface-2 px-4">
      <div className="flex items-center gap-3">
        {voice.kind === "listening" ? (
          <span className="grid size-5 place-items-center" aria-hidden>
            <span className="size-2.5 rounded-full bg-danger transition-transform duration-75" style={{ transform: `scale(${1 + level * 1.2})` }} />
          </span>
        ) : (
          <Plus size={20} className="text-accent" />
        )}
        <input
          ref={input}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void submit();
            if (e.key === "Escape") {
              if (parsed.chips.length && !raw && !busy) setRaw(true);
              else void hide();
            }
          }}
          placeholder={voice.kind === "listening" ? "Listening… release the shortcut or click the mic when done" : voice.kind === "transcribing" ? "Transcribing…" : "Add a task to Momentum…"}
          readOnly={busy}
          aria-label="Quick add task"
          className="h-12 flex-1 bg-transparent text-lg outline-none placeholder:text-muted"
        />
        <button
          type="button"
          onClick={() => void toggleVoice()}
          disabled={voice.kind === "transcribing"}
          aria-pressed={voice.kind === "listening"}
          aria-label={voice.kind === "listening" ? "Stop listening" : "Speak a task"}
          title={voice.kind === "listening" ? "Stop listening" : "Speak a task (or hold the push-to-talk shortcut)"}
          className={`grid size-9 place-items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${voice.kind === "listening" ? "bg-accent text-accent-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
        >
          <Mic size={18} className={voice.kind === "transcribing" ? "animate-pulse" : ""} />
        </button>
      </div>
      <div className="flex min-h-7 flex-wrap items-center gap-1.5 pb-1">
        {voice.kind === "error" && (
          <span role="alert" className="text-xs font-medium text-danger">
            {voice.message}
          </span>
        )}
        {context && (
          <span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-xs font-medium">
            {context.kind === "list" ? <List size={12} className="text-accent" /> : <CalendarDays size={12} className="text-accent" />}
            {contextLabel(context, today)}
          </span>
        )}
        {parsed.chips.map((c) => {
          if (c.kind === "priority" || (c.kind === "list" && lists.length > 0)) return picker(c.kind, label(c.kind, c.text));
          const Icon = ICON[c.kind];
          return (
            <span key={`${c.kind}-${c.start}`} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium">
              <Icon size={12} className="text-accent" />
              {label(c.kind, c.text)}
            </span>
          );
        })}
        {parsing && (
          <>
            {!parsed.chips.some((c) => c.kind === "priority") && picker("priority", null)}
            {lists.length > 0 && !parsed.chips.some((c) => c.kind === "list") && picker("list", null)}
            <button
              type="button"
              onClick={() => {
                setText((t) => `${t.trimEnd()} #`.trimStart());
                input.current?.focus();
              }}
              className="h-6 rounded-full border border-dashed border-border px-2 text-xs text-fg-2 hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
            >
              + Tag
            </button>
          </>
        )}
        <span className="ml-auto text-xs text-muted">
          <kbd className="font-mono">Enter</kbd> add · <kbd className="font-mono">Esc</kbd> {parsed.chips.length && !raw ? "plain text" : "close"}
        </span>
      </div>
    </div>
  );
}
