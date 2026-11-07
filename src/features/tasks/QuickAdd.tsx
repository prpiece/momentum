import { CalendarDays, Flag, Hash, List, Plus, Repeat, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTokenSuggest } from "../../components/ui/TokenSuggest";
import { formatTime, relativeDayLabel, todayLocal } from "../../domain/dates";
import { parseQuickAdd, type ChipKind } from "../../domain/quickAdd";
import { describeRule } from "../../domain/recurrence";
import { PRIORITY_LABEL, type Task } from "../../domain/types";
import { useData, type NewTask } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { createFromText, listByName } from "./quickAddSubmit";

const CHIP_ICON: Record<ChipKind, typeof Flag> = {
  date: CalendarDays,
  priority: Flag,
  tag: Hash,
  list: List,
  repeat: Repeat,
};

export const QUICK_ADD_EVENT = "momentum:quick-add";
export const QUICK_ADD_POPUP_EVENT = "momentum:quick-add-popup";
/**
 * Focus the quick-add bar of the current view (keyboard `N`, palette "New task"). A mounted bar
 * cancels the event; if none did (boards, calendar, matrix...), the popup opens instead (D70).
 */
export const focusQuickAdd = () => {
  if (window.dispatchEvent(new Event(QUICK_ADD_EVENT, { cancelable: true }))) window.dispatchEvent(new Event(QUICK_ADD_POPUP_EVENT));
};

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
  const input = useRef<HTMLInputElement>(null);
  const parsing = smartParse && !rawMode;

  useEffect(() => {
    const focus = (e: Event) => {
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener(QUICK_ADD_EVENT, focus);
    return () => window.removeEventListener(QUICK_ADD_EVENT, focus);
  }, []);

  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const names = useMemo(() => Object.values(lists).map((l) => l.name), [lists]);
  const openListNames = useMemo(() => Object.values(lists).filter((l) => !l.archived).sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.name), [lists]);
  const tagNames = useMemo(() => Object.values(tags).map((t) => t.name).sort((a, b) => a.localeCompare(b)), [tags]);
  const parsed = useMemo(() => parseQuickAdd(text, new Date(), parsing, names), [text, parsing, names]);
  const today = todayLocal();
  const complete = useTokenSuggest({ text, setText, input, lists: parsing ? openListNames : [], tags: parsing ? tagNames : [] });

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
    if (kind === "list" && parsed.listName) return listByName(parsed.listName)?.name ?? `${parsed.listName} (no such list)`;
    return raw;
  };

  const submit = () => {
    const t = createFromText(text, props.defaults, parsing, (task) => !!props.isVisible && !props.isVisible(task));
    if (!t) return;
    props.onAdded?.(t);
    setText("");
    setRawMode(false);
  };

  return (
    <div className="rounded-card border border-border bg-raised transition-shadow duration-[var(--dur)] focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
      <div className="flex items-center gap-2.5 px-3">
        <Plus size={18} className="shrink-0 text-accent" />
        <input
          ref={input}
          value={text}
          autoFocus={props.autoFocus}
          onChange={(e) => setText(e.target.value)}
          {...complete.inputProps}
          onKeyDown={(e) => {
            if (complete.onKeyDown(e)) return;
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
            className={`grid size-7 place-items-center rounded-control ${parsing ? "text-accent" : "text-muted"} hover:bg-surface-2`}
          >
            <Sparkles size={15} />
          </button>
        )}
      </div>
      {complete.open ? (
        <div className="border-t border-border px-3 py-2">{complete.row}</div>
      ) : parsing && parsed.chips.length > 0 && (
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
            <kbd className="tabular-nums">Esc</kbd> to keep as plain text
          </span>
        </div>
      )}
    </div>
  );
}
