import { Repeat } from "lucide-react";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import type { CalItem } from "../../domain/calendar";
import { formatTime } from "../../domain/dates";
import type { Settings } from "../../domain/types";
import { toggleDone } from "../tasks/actions";
import { onItemMenu, openItem } from "./Blocks";

/** One calendar item as a list row: time, checkbox or colour mark, title. Agenda view and the Day brief. */
export function AgendaRow({ item: i, timeFormat, timeWidth = "w-28" }: { item: CalItem; timeFormat: Settings["timeFormat"]; timeWidth?: string }) {
  return (
    <div role="button" tabIndex={0} onClick={() => openItem(i)} onContextMenu={onItemMenu(i)} onKeyDown={(e) => e.key === "Enter" && openItem(i)} className="flex items-center gap-3 rounded-control px-2 py-1.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent-text">
      <span className={`${timeWidth} shrink-0 tabular-nums text-[length:var(--fs-sm)] text-muted`}>
        {i.allDay || !i.start || !i.end ? "All day" : `${formatTime(i.start, timeFormat)} – ${formatTime(i.end, timeFormat)}`}
      </span>
      {i.source === "task" ? (
        <TaskCheckbox status={i.done ? "done" : "open"} priority={i.priority} onToggle={() => toggleDone(i.id, i.key)} label={`Complete ${i.title}`} size={16} />
      ) : (
        <span className="size-3 shrink-0 rounded-[4px]" style={{ background: i.color }} />
      )}
      <span className={`min-w-0 flex-1 truncate ${i.done ? "text-muted line-through" : ""}`}>{i.title}</span>
      {i.recurring && <Repeat size={16} strokeWidth={1.75} className="text-muted" />}
    </div>
  );
}
