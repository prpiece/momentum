import { MessageSquareText } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "../../components/ui/Popover";
import type { Habit, Mood } from "../../domain/habits";
import type { LocalDate } from "../../domain/types";
import { checkinOf, setCheckin, useHabits } from "../../stores/habits";

export const MOOD_EMOJI = ["😞", "😕", "😐", "🙂", "😄"];
const MOODS: Mood[] = [1, 2, 3, 4, 5];

/** Optional daily note + mood for a habit. */
export function NoteButton({ habit, date }: { habit: Habit; date: LocalDate }) {
  const c = useHabits((s) => s.checkins[habit.id]?.[date]);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`Note for ${habit.name}`}
        title="Note & mood"
        onClick={(e) => {
          e.stopPropagation();
          setNote(checkinOf(habit.id, date)?.note ?? "");
          setOpen(true);
        }}
        className={`grid size-7 shrink-0 place-items-center rounded-sm hover:bg-hover ${c?.note || c?.mood ? "text-accent" : "text-muted opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
      >
        {c?.mood ? <span className="text-sm">{MOOD_EMOJI[c.mood - 1]}</span> : <MessageSquareText size={15} />}
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => (setCheckin(habit.id, date, { note: note.trim() }), setOpen(false))} align="end" className="w-64 p-3">
          <div className="mb-2 flex justify-between" role="radiogroup" aria-label="Mood">
            {MOODS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={c?.mood === m}
                aria-label={`Mood ${m} of 5`}
                onClick={() => setCheckin(habit.id, date, { mood: c?.mood === m ? null : m })}
                className={`grid size-9 place-items-center rounded-full text-xl transition-transform hover:scale-110 ${c?.mood === m ? "bg-accent-soft ring-2 ring-accent" : ""}`}
              >
                {MOOD_EMOJI[m - 1]}
              </button>
            ))}
          </div>
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="How did it go?" aria-label="Note" className="min-h-20 w-full resize-none rounded-sm border border-border bg-surface p-2 text-sm outline-none focus:border-accent" />
          <p className="mt-1 text-[0.65rem] text-muted">Saved when you close this.</p>
        </Popover>
      )}
    </>
  );
}
