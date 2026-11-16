import { format } from "date-fns";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "../../components/ui/Popover";
import { type FocusPick, NO_PICK } from "../../domain/focus";
import { addManualSession } from "../../stores/focus";
import { toast } from "../../stores/toast";
import { TaskPicker } from "./TaskPicker";

const LOCAL = "yyyy-MM-dd'T'HH:mm";

/** Log focus time you forgot to start (HAB-25): a task, when it began and how long. */
export function AddSession() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<FocusPick>(NO_PICK);
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState("30");

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => (setStart(format(new Date(Date.now() - 30 * 60_000), LOCAL)), setOpen(true))}
        className="btn btn-ghost btn-sm self-start text-muted"
      >
        <Plus size={14} strokeWidth={1.75} /> Add past session
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} className="w-72 p-3">
          <form
            className="flex flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (addManualSession(pick.taskId, new Date(start).getTime(), Number(minutes))) setOpen(false);
              else toast("A session needs a start in the past and 1 to 1440 minutes, ending before now.");
            }}
          >
            <TaskPicker value={pick} onChange={setPick} />
            <label className="text-xs font-semibold text-muted">
              Started
              <input type="datetime-local" required value={start} max={format(new Date(), LOCAL)} onChange={(e) => setStart(e.target.value)} className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-semibold text-muted">
              Length (minutes)
              <input type="number" required min={1} max={1440} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="input mt-1 w-full" />
            </label>
            <button type="submit" className="btn btn-primary">
              Add session
            </button>
          </form>
        </Popover>
      )}
    </>
  );
}
