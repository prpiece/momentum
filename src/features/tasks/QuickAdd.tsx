import { CalendarDays, Flag, Hash, List, Plus, Repeat, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTime, relativeDayLabel, todayLocal } from "../../domain/dates";
import { parseQuickAdd, type ChipKind } from "../../domain/quickAdd";
import { describeRule } from "../../domain/recurrence";
import { PRIORITY_LABEL, type Task } from "../../domain/types";
import { addTask, ensureTags, useData, type NewTask } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { openTask, toast } from "../../stores/ui";

const CHIP_ICON: Record<ChipKind, typeof Flag> = {
  date: CalendarDays,
  priority: Flag,
  tag: Hash,
  list: List,
  repeat: Repeat,
};

export const QUICK_ADD_EVENT = "momentum:quick-add";
/** Focus the quick-add bar of the current view (keyboard `N`, palette "New task"). */
export const focusQuickAdd = () => window.dispatchEvent(new Event(QUICK_ADD_EVENT));

/**
 * Always-visible add bar. Natural language is parsed live and shown as chips; Esc turns
 * parsing off for the current entry (or globally via Settings).
 */
export function QuickAdd(props: {
  defaults: Partial<NewTask>;
  placeholder?: string;
  onAdded?: (t: Task) => void;
  autoFocus?: boolean;
  /** When the new task won't appear in the current view, a toast says where it went. */
  isVisible?: (t: Task) => boolean;
}) {
  const [text, setText] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const smartParse = useSettings((s) => s.settings.smartParse);
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const lists = useData((s) => s.lists);
  const input = useRef<HTMLInputElement>(null);
  const parsing = smartParse && !rawMode;

  useEffect(() => {
    const focus = () => input.current?.focus();
    window.addEventListener(QUICK_ADD_EVENT, focus);
    return () => window.removeEventListener(QUICK_ADD_EVENT, focus);
  }, []);

  const parsed = useMemo(() => parseQuickAdd(text, new Date(), parsing), [text, parsing]);
  const today = todayLocal();
  const listByName = (name: string) =>
    Object.values(lists).find((l) => l.name.replace(/\s+/g, "").toLowerCase() === name.toLowerCase());

  const chipLabel = (kind: ChipKind, raw: string): string => {
    const s = parsed.schedule;
    if (kind === "date") {
      if (s.kind === "day") return relativeDayLabel(s.date, today);
      if (s.kind === "timed") {
        const d = new Date(s.start);
        return `${relativeDayLabel(todayLocal(d), today)} ${formatTime(d, timeFormat)}`;
      }
    }
    if (kind === "priority" && parsed.priority !== null) return PRIORITY_LABEL[parsed.priority];
    if (kind === "repeat" && parsed.rule) return describeRule(parsed.rule);
    if (kind === "list") return listByName(raw.slice(1))?.name ?? `${raw} (no such list)`;
    return raw;
  };

  const submit = () => {
    if (!text.trim()) return;
    const p = parsed;
    const listId = (p.listName && listByName(p.listName)?.id) || props.defaults.listId;
    const t = addTask({
      ...props.defaults,
      title: p.title,
      ...(listId ? { listId } : {}),
      ...(p.schedule.kind !== "none" ? { schedule: p.schedule } : {}),
      ...(p.priority !== null ? { priority: p.priority } : {}),
      tags: [...new Set([...(props.defaults.tags ?? []), ...ensureTags(p.tags)])],
      recurrence: p.rule ? { rule: p.rule, exdates: [] } : null,
    });
    if (p.listName && !listByName(p.listName)) toast(`No list named “${p.listName}”; added to ${lists[t.listId]?.name ?? "Inbox"}`);
    if (props.isVisible && !props.isVisible(t)) {
      const s = t.schedule;
      const when = s.kind === "none" ? "" : ` for ${relativeDayLabel(s.kind === "day" ? s.date : todayLocal(new Date(s.start)), today)}`;
      toast(`Added to ${lists[t.listId]?.name ?? "Inbox"}${when}`, { label: "Open", run: () => openTask(t.id) });
    }
    props.onAdded?.(t);
    setText("");
    setRawMode(false);
  };

  return (
    <div className="rounded-md border border-border bg-surface-2 shadow-sm transition-shadow duration-[var(--dur)] focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
      <div className="flex items-center gap-2.5 px-3">
        <Plus size={18} className="shrink-0 text-accent" />
        <input
          ref={input}
          value={text}
          autoFocus={props.autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              if (parsed.chips.length && !rawMode) {
                e.stopPropagation();
                setRawMode(true);
              } else if (text) {
                e.stopPropagation();
                setText("");
                setRawMode(false);
              }
            }
          }}
          placeholder={props.placeholder ?? "Add a task, e.g. “Study chem tomorrow 5pm !high #school”"}
          aria-label="Add a task"
          className="h-11 min-w-0 flex-1 bg-transparent text-[0.95rem] outline-none placeholder:text-muted"
        />
        {smartParse && (
          <button
            type="button"
            title={parsing ? "Smart parsing on (Esc to ignore for this task)" : "Smart parsing off for this task"}
            aria-pressed={parsing}
            onClick={() => setRawMode((r) => !r)}
            className={`grid size-7 place-items-center rounded-sm ${parsing ? "text-accent" : "text-muted"} hover:bg-hover`}
          >
            <Sparkles size={15} />
          </button>
        )}
      </div>
      {parsing && parsed.chips.length > 0 && (
        <div className="anim-fade flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
          {parsed.chips.map((c) => {
            const Icon = CHIP_ICON[c.kind];
            return (
              <span key={`${c.kind}-${c.start}`} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-fg">
                <Icon size={12} className="text-accent" />
                {chipLabel(c.kind, c.text)}
              </span>
            );
          })}
          <span className="ml-auto text-xs text-muted">
            <kbd className="font-mono">Esc</kbd> to keep as plain text
          </span>
        </div>
      )}
    </div>
  );
}
