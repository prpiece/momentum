import { Trophy } from "lucide-react";
import { useMemo } from "react";
import { TROPHIES } from "../../domain/perfect";
import { trophiesEarned } from "../../lib/celebrate";
import { useData } from "../../stores/data";
import { useFocus } from "../../stores/focus";
import { useHabits } from "../../stores/habits";
import { useProgress } from "../../stores/progress";

/** Statistics → Trophies: earned ones in gold, the rest greyed with how to get them (D64). */
export function TrophyShelf() {
  const tasks = useData((s) => s.tasks);
  const checkins = useHabits((s) => s.checkins);
  const sessions = useFocus((s) => s.sessions);
  const restDays = useProgress((s) => s.restDays);
  // The inputs are read from the stores inside; these references say when to recompute.
  const earned = useMemo(() => trophiesEarned(), [tasks, checkins, sessions, restDays]);
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {TROPHIES.map((t) => {
        const got = earned.has(t.id);
        return (
          <li key={t.id} title={t.hint} className={`flex flex-col items-center gap-2 rounded-md border p-3 text-center ${got ? "border-[#e8a317]/50 bg-[#f5c542]/10" : "border-border opacity-55"}`}>
            <span className={`grid size-11 place-items-center rounded-full ${got ? "bg-gradient-to-br from-[#ffd970] to-[#e8a317] text-white shadow-md" : "bg-hover text-muted"}`}>
              <Trophy size={20} />
            </span>
            <span className="text-xs font-semibold leading-tight">{t.name}</span>
            <span className="text-[0.65rem] leading-tight text-muted">{got ? "Earned" : t.hint}</span>
          </li>
        );
      })}
    </ul>
  );
}
