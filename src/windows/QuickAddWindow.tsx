import { CalendarDays, Flag, Hash, List, Plus, Repeat } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTime, relativeDayLabel, todayLocal } from "../domain/dates";
import { parseQuickAdd, type ChipKind } from "../domain/quickAdd";
import { describeRule } from "../domain/recurrence";
import { PRIORITY_LABEL } from "../domain/types";
import { apply, readAppearance } from "../lib/applySettings";

const ICON: Record<ChipKind, typeof Flag> = { date: CalendarDays, priority: Flag, tag: Hash, list: List, repeat: Repeat };

/**
 * The small always-on-top window behind the global shortcut. It has no database access: it
 * parses for preview only and hands the text to the main window, which creates the task.
 */
export function QuickAddWindow() {
  const [text, setText] = useState("");
  const [raw, setRaw] = useState(false);
  const [appearance, setAppearance] = useState(readAppearance);
  const input = useRef<HTMLInputElement>(null);
  const smart = appearance?.smartParse ?? true;
  const parsed = useMemo(() => parseQuickAdd(text, new Date(), smart && !raw), [text, smart, raw]);

  useEffect(() => {
    if (appearance) apply(appearance);
    const onStorage = () => setAppearance(readAppearance());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [appearance]);

  useEffect(() => {
    let off: (() => void)[] = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      off = [
        await listen("quickadd:focus", () => {
          setAppearance(readAppearance());
          input.current?.focus();
          input.current?.select();
        }),
        await w.onFocusChanged(({ payload }) => {
          if (!payload) void w.hide();
        }),
      ];
    })();
    return () => off.forEach((f) => f());
  }, []);

  const hide = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  };
  const submit = async () => {
    if (!text.trim()) return;
    const { emit } = await import("@tauri-apps/api/event");
    await emit("quickadd:create", { text, raw });
    setText("");
    setRaw(false);
    await hide();
  };

  const today = todayLocal();
  const label = (kind: ChipKind, chipText: string) => {
    const s = parsed.schedule;
    if (kind === "date" && s.kind === "day") return relativeDayLabel(s.date, today);
    if (kind === "date" && s.kind === "timed") return `${relativeDayLabel(todayLocal(new Date(s.start)), today)} ${formatTime(new Date(s.start), appearance?.timeFormat ?? "24h")}`;
    if (kind === "priority" && parsed.priority !== null) return PRIORITY_LABEL[parsed.priority];
    if (kind === "repeat" && parsed.rule) return describeRule(parsed.rule);
    return chipText;
  };

  return (
    <div className="flex h-full flex-col justify-center border border-border bg-surface-2 px-4">
      <div className="flex items-center gap-3">
        <Plus size={20} className="text-accent" />
        <input
          ref={input}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") {
              if (parsed.chips.length && !raw) setRaw(true);
              else void hide();
            }
          }}
          placeholder="Add a task to Momentum…"
          aria-label="Quick add task"
          className="h-12 flex-1 bg-transparent text-lg outline-none placeholder:text-muted"
        />
      </div>
      <div className="flex min-h-7 flex-wrap items-center gap-1.5 pb-1">
        {parsed.chips.map((c) => {
          const Icon = ICON[c.kind];
          return (
            <span key={`${c.kind}-${c.start}`} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium">
              <Icon size={12} className="text-accent" />
              {label(c.kind, c.text)}
            </span>
          );
        })}
        <span className="ml-auto text-xs text-muted">
          <kbd className="font-mono">Enter</kbd> add · <kbd className="font-mono">Esc</kbd> {parsed.chips.length && !raw ? "plain text" : "close"}
        </span>
      </div>
    </div>
  );
}
