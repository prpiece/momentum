import { CalendarDays, CheckCircle2 } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "../../components/ui/Popover";
import { formatTime, relativeDayLabel, scheduleDate, todayLocal } from "../../domain/dates";
import type { Schedule } from "../../domain/types";
import { addEvent } from "../../stores/data";
import { useAddSuggest } from "../tasks/InlineAdd";
import { createFromText } from "../../stores/quickAddSubmit";
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
  const smartParse = useSettings((s) => s.settings.smartParse);
  const input = useRef<HTMLInputElement>(null);
  const ac = useAddSuggest(title, setTitle, input, kind === "task");
  const create = (more: boolean) => {
    const name = title.trim() || (kind === "task" ? "New task" : "New event");
    if (kind === "task") {
      // Tokens in the title (D220) win over the slot that was clicked; the slot is the default.
      const t = createFromText(name, { schedule: draft.schedule }, smartParse, () => false);
      if (!t) return;
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
      <div role="radiogroup" aria-label="Create" className="seg mb-2 flex">
        {(["task", "event"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`seg-item flex-1 justify-center ${kind === k ? "is-on" : ""}`}
          >
            {k === "task" ? <CheckCircle2 size={13} /> : <CalendarDays size={13} />}
            {k === "task" ? "Task" : "Event"}
          </button>
        ))}
      </div>
      <input
        ref={input}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        {...ac.inputProps}
        onKeyDown={(e) => {
          if (!ac.onKeyDown(e) && e.key === "Enter") create(false);
        }}
        placeholder={kind === "task" ? "Task title, e.g. “Study chem !high #school”" : "Event title"}
        aria-label="Title"
        className="input w-full"
      />
      {ac.open && <div className="mt-2">{ac.row}</div>}
      <div className="mt-1.5 tabular-nums text-[length:var(--fs-xs)] text-muted">{when}</div>
      <div className="mt-3 flex justify-between">
        <button type="button" onClick={() => create(true)} className="btn btn-ghost btn-sm">
          More options
        </button>
        <button type="button" onClick={() => create(false)} className="btn btn-primary btn-sm">
          Save
        </button>
      </div>
    </Popover>
  );
}
