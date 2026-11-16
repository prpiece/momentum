import { format } from "date-fns";
import { useMemo } from "react";
import { addDaysLocal, formatTime, fromLocalDate, todayLocal } from "../../domain/dates";
import { nextItems } from "../../domain/home";
import { useSettings } from "../../stores/settings";
import { go, openEvent, openTask } from "../../stores/ui";
import { useCalendarItems } from "../calendar/useCalendarItems";
import { HomeCard, Quiet, Row } from "./HomeCard";

/** The next few tasks and events on the calendar this week. */
export function NextUpCard() {
  const fmt = useSettings((s) => s.settings.timeFormat);
  const today = todayLocal();
  const items = useCalendarItems(today, addDaysLocal(today, 6));
  const next = useMemo(() => nextItems(items, new Date(), 5), [items]);
  const tomorrow = addDaysLocal(today, 1);
  const when = (day: string) => (day === today ? "Today" : day === tomorrow ? "Tomorrow" : format(fromLocalDate(day), "EEE d"));

  return (
    <HomeCard title="Next on your calendar" onOpen={() => go("calendar")}>
      {next.length === 0 ? (
        <Quiet>Nothing scheduled in the next week.</Quiet>
      ) : (
        <ul>
          {next.map((i) => (
            <li key={i.uid}>
              <Row onClick={() => (i.source === "event" ? openEvent(i.id, i.key) : openTask(i.id, i.key))}>
                <span className="size-2 shrink-0 rounded-full" style={{ background: i.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                <span className="shrink-0 text-muted tabular-nums">
                  {when(i.startDate)}
                  {i.start ? `, ${formatTime(i.start, fmt)}` : ""}
                </span>
              </Row>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}
