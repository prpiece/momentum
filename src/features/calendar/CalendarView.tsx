import { ChevronLeft, ChevronRight, PanelRight, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useMemo } from "react";
import { MenuLabel, MenuSeparator, Popover, useMenu } from "../../components/ui/Popover";
import { dayRange, rangeTitle, stepAnchor, viewDays } from "../../domain/calendar";
import { addDaysLocal, todayLocal } from "../../domain/dates";
import { CAL_VIEWS, type CalView, type CalendarSettings } from "../../domain/types";
import { useViewKeys } from "../../lib/shortcuts";
import { useSettings } from "../../stores/settings";
import { setCalAnchor, setCalSpan, useUi } from "../../stores/ui";
import { AgendaView } from "./AgendaView";
import { MonthView } from "./MonthView";
import { SidePanel } from "./SidePanel";
import { TimeGrid } from "./TimeGrid";
import { useCalendarItems } from "./useCalendarItems";
import "./calendarActions";

const LABEL: Record<CalView, [string, string]> = {
  day: ["Day", "D"],
  "5day": ["5 days", "X"],
  week: ["Week", "W"],
  month: ["Month", "M"],
  agenda: ["Agenda", "A"],
};
const KEY_VIEW: Record<string, CalView> = { d: "day", x: "5day", w: "week", m: "month", a: "agenda" };

export function CalendarView() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const cal = settings.calendar;
  const anchor = useUi((s) => s.calAnchor);
  const span = useUi((s) => s.calSpan);
  const setCal = useCallback(
    (patch: Partial<CalendarSettings>) => {
      if (patch.view) setCalSpan(null);
      update({ calendar: { ...useSettings.getState().settings.calendar, ...patch } });
    },
    [update],
  );
  const view = cal.view;
  // A day range dragged out on the mini month overrides the view's own range (Google Calendar style).
  const days = useMemo(() => (span ? dayRange(anchor, span) : viewDays(view, anchor, settings.weekStart)), [span, view, anchor, settings.weekStart]);
  const step = useCallback((from: string, dir: 1 | -1) => (span ? addDaysLocal(from, span * dir) : stepAnchor(view, from, dir)), [span, view]);
  const items = useCalendarItems(days[0], days[days.length - 1]);
  const options = useMenu();

  useViewKeys(
    useCallback(
      (e: KeyboardEvent) => {
        const k = e.key.toLowerCase();
        if (KEY_VIEW[k]) return setCal({ view: KEY_VIEW[k] }), true;
        if (k === "t") return setCalAnchor(todayLocal()), true;
        if (e.key === "ArrowLeft") return setCalAnchor(step(useUi.getState().calAnchor, -1)), true;
        if (e.key === "ArrowRight") return setCalAnchor(step(useUi.getState().calAnchor, 1)), true;
        return false;
      },
      [step, setCal],
    ),
  );

  const openDay = (d: string) => {
    setCalAnchor(d);
    setCal({ view: "day" });
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
          <button type="button" onClick={() => setCalAnchor(todayLocal())} className="h-8 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover" title="Today (T)">
            Today
          </button>
          <div className="flex">
            <button type="button" aria-label="Previous" title="Previous (←)" onClick={() => setCalAnchor(step(anchor, -1))} className="grid size-8 place-items-center rounded-sm text-fg-2 hover:bg-hover">
              <ChevronLeft size={18} />
            </button>
            <button type="button" aria-label="Next" title="Next (→)" onClick={() => setCalAnchor(step(anchor, 1))} className="grid size-8 place-items-center rounded-sm text-fg-2 hover:bg-hover">
              <ChevronRight size={18} />
            </button>
          </div>
          <h2 className="mr-auto text-base font-semibold tracking-tight">{rangeTitle(span ? "5day" : view, days, anchor)}</h2>
          {span && (
            <button type="button" onClick={() => setCalSpan(null)} title="Back to the selected view" className="anim-pop flex h-7 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-xs font-medium text-accent hover:bg-accent hover:text-accent-fg">
              {span} days <X size={12} />
            </button>
          )}
          <div role="radiogroup" aria-label="Calendar view" className="flex rounded-sm border border-border bg-bg p-0.5">
            {CAL_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={!span && view === v}
                title={`${LABEL[v][0]} (${LABEL[v][1]})`}
                onClick={() => setCal({ view: v })}
                className={`h-7 rounded-[6px] px-2.5 text-xs ${!span && view === v ? "bg-surface-2 font-semibold text-fg shadow-sm" : "text-muted hover:text-fg"}`}
              >
                {LABEL[v][0]}
              </button>
            ))}
          </div>
          <button ref={options.anchor} type="button" aria-label="View options" title="View options" onClick={options.toggle} className="grid size-8 place-items-center rounded-sm text-muted hover:bg-hover hover:text-fg">
            <SlidersHorizontal size={16} />
          </button>
          <button type="button" aria-label="Toggle side panel" aria-pressed={cal.arrangeOpen} title="Arrange tasks" onClick={() => setCal({ arrangeOpen: !cal.arrangeOpen })} className={`grid size-8 place-items-center rounded-sm hover:bg-hover ${cal.arrangeOpen ? "text-accent" : "text-muted"}`}>
            <PanelRight size={16} />
          </button>
          {options.open && (
            <Popover anchor={options.anchor} onClose={options.close} align="end" className="w-60 p-2">
              <MenuLabel>Color by</MenuLabel>
              <div className="flex gap-1 px-1.5 pb-1">
                {(["list", "priority", "tag"] as const).map((c) => (
                  <button key={c} type="button" onClick={() => setCal({ colorBy: c })} className={`h-7 flex-1 rounded-sm text-xs capitalize ${cal.colorBy === c ? "bg-accent text-accent-fg" : "bg-hover text-fg-2"}`}>
                    {c}
                  </button>
                ))}
              </div>
              <MenuSeparator />
              <MenuLabel>Show</MenuLabel>
              {(
                [
                  ["showCompleted", "Completed tasks"],
                  ["showHabits", "Habits"],
                  ["showFocus", "Focus records"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm hover:bg-hover">
                  <input type="checkbox" checked={cal[k]} onChange={(e) => setCal({ [k]: e.target.checked })} className="size-4 accent-[var(--accent)]" />
                  {label}
                </label>
              ))}
              <MenuSeparator />
              <MenuLabel>Density</MenuLabel>
              <div className="flex gap-1 px-1.5 pb-1">
                {(["comfortable", "compact"] as const).map((d) => (
                  <button key={d} type="button" onClick={() => setCal({ density: d })} className={`h-7 flex-1 rounded-sm text-xs capitalize ${cal.density === d ? "bg-accent text-accent-fg" : "bg-hover text-fg-2"}`}>
                    {d}
                  </button>
                ))}
              </div>
              <p className="px-2.5 pt-1 text-[0.7rem] text-muted">Week start and 12/24-hour time are in Settings.</p>
            </Popover>
          )}
        </div>
        {span ? (
          <TimeGrid days={days} items={items} onViewDay={openDay} />
        ) : view === "month" ? (
          <MonthView days={days} anchor={anchor} items={items} weekStart={settings.weekStart} onViewDay={openDay} />
        ) : view === "agenda" ? (
          <AgendaView days={days} items={items} />
        ) : (
          <TimeGrid days={days} items={items} onViewDay={openDay} />
        )}
      </div>
      {cal.arrangeOpen && <SidePanel weekStart={settings.weekStart} visible={days} />}
    </div>
  );
}
