import { CalendarDays, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Popover } from "../../components/ui/Popover";
import { formatTime, relativeDayLabel, scheduleDate, todayLocal } from "../../domain/dates";
import type { Schedule } from "../../domain/types";
import { addEvent, addTask } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { openEvent, openTask } from "../../stores/ui";

export type Draft = { anchor: { x: number; y: number }; schedule: Schedule; onClose?: () => void };

/** Inline "new task / event" bubble shown after clicking or dragging on the calendar. */
export function CreatePopover({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"task" | "event">("task");
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const close = () => {
    draft.onClose?.();
    onClose();
  };
  const create = (more: boolean) => {
    const name = title.trim() || (kind === "task" ? "New task" : "New event");
    if (kind === "task") {
      const t = addTask({ title: name, schedule: draft.schedule });
      if (more) openTask(t.id);
    } else {
      const e = addEvent({ title: name, schedule: draft.schedule });
      if (more) openEvent(e.id);
    }
    close();
  };
  const s = draft.schedule;
  const date = scheduleDate(s);
  const when =
    s.kind === "timed"
      ? `${relativeDayLabel(date ?? todayLocal(), todayLocal())}, ${formatTime(new Date(s.start), timeFormat)} – ${formatTime(new Date(s.end), timeFormat)}`
      : date
        ? `${relativeDayLabel(date, todayLocal())} · all day`
        : "";

  return (
    <Popover anchor={draft.anchor} onClose={close} className="w-72 p-3">
      <div role="radiogroup" aria-label="Create" className="mb-2 flex gap-1">
        {(["task", "event"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs ${kind === k ? "bg-accent text-accent-fg" : "bg-hover text-fg-2"}`}
          >
            {k === "task" ? <CheckCircle2 size={13} /> : <CalendarDays size={13} />}
            {k === "task" ? "Task" : "Event"}
          </button>
        ))}
      </div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create(false)}
        placeholder={kind === "task" ? "Task title" : "Event title"}
        aria-label="Title"
        className="h-9 w-full rounded-sm border border-border bg-surface px-2.5 text-sm outline-none focus:border-accent"
      />
      <div className="mt-1.5 font-mono text-[0.7rem] text-muted">{when}</div>
      <div className="mt-3 flex justify-between">
        <button type="button" onClick={() => create(true)} className="h-8 rounded-sm px-2 text-xs text-fg-2 hover:bg-hover">
          More options
        </button>
        <button type="button" onClick={() => create(false)} className="h-8 rounded-sm bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover">
          Save
        </button>
      </div>
    </Popover>
  );
}
