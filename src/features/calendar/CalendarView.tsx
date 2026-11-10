import { Tip } from "../../components/ui/Tip";
import { ChevronDown, ChevronLeft, ChevronRight, PanelRight, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useMemo } from "react";
import { MenuItem, MenuLabel, MenuSeparator, Popover, useMenu } from "../../components/ui/Popover";
import { Switch } from "../../components/ui/Switch";
import { ToolbarActions } from "../../components/ui/Toolbar";
import { dayRange, rangeTitle, stepAnchor, viewDays } from "../../domain/calendar";
import { addDaysLocal, todayLocal } from "../../domain/dates";
import { CAL_VIEWS, type CalView, type CalendarSettings } from "../../domain/types";
import { useViewKeys } from "../../lib/shortcuts";
import { useSettings } from "../../stores/settings";
import { setCalAnchor, setCalSpan, useUi } from "../../stores/ui";
import { AgendaView } from "./AgendaView";
import { DayBrief } from "./DayBrief";
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
  const viewMenu = useMenu();

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
        <ToolbarActions>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setCalAnchor(todayLocal())} className="btn btn-secondary" title="Today (T)">
            Today
          </button>
          <Tip label="Previous (←)">
          <button type="button" aria-label="Previous" onClick={() => setCalAnchor(step(anchor, -1))} className="btn btn-ghost icon-btn">
            <ChevronLeft size={18} strokeWidth={1.75} />
          </button>
          </Tip>
          <Tip label="Next (→)">
          <button type="button" aria-label="Next" onClick={() => setCalAnchor(step(anchor, 1))} className="btn btn-ghost icon-btn">
            <ChevronRight size={18} strokeWidth={1.75} />
          </button>
          </Tip>
          <h2 className="ml-1 mr-3 whitespace-nowrap text-[length:var(--fs-lg)] font-semibold leading-[var(--lh-lg)] max-[1100px]:mr-1 max-[1100px]:text-[length:var(--fs-base)] max-[799px]:hidden">{rangeTitle(span ? "5day" : view, days, anchor)}</h2>
          {span && (
            <button type="button" onClick={() => setCalSpan(null)} title="Back to the selected view" aria-pressed="true" className="anim-pop btn btn-ghost btn-sm max-[1100px]:hidden">
              {span} days <X size={14} strokeWidth={1.75} />
            </button>
          )}
          <div role="radiogroup" aria-label="Calendar view" className="seg max-[1100px]:hidden">
            {CAL_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={!span && view === v}
                title={`${LABEL[v][0]} (${LABEL[v][1]})`}
                onClick={() => setCal({ view: v })}
                className={`seg-item ${!span && view === v ? "is-on" : ""}`}
              >
                {LABEL[v][0]}
              </button>
            ))}
          </div>
          {/* Narrow windows: the five views collapse to one menu button (it also shows a dragged day span). */}
          <button ref={viewMenu.anchor} type="button" aria-label="Calendar view" aria-haspopup="menu" aria-expanded={viewMenu.open} onClick={viewMenu.toggle} className="btn btn-secondary min-[1100px]:hidden">
            {span ? `${span} days` : LABEL[view][0]} <ChevronDown size={14} strokeWidth={1.75} />
          </button>
          {viewMenu.open && (
            <Popover anchor={viewMenu.anchor} onClose={viewMenu.close} align="end">
              {CAL_VIEWS.map((v) => (
                <MenuItem key={v} active={!span && view === v} onSelect={() => (setCal({ view: v }), viewMenu.close())}>
                  {LABEL[v][0]}
                </MenuItem>
              ))}
            </Popover>
          )}
          <span className="tb-sep" aria-hidden />
          <Tip label="View options">
          <button ref={options.anchor} type="button" aria-label="View options" onClick={options.toggle} className="btn btn-ghost icon-btn">
            <SlidersHorizontal size={16} strokeWidth={1.75} />
          </button>
          </Tip>
          <Tip label="Arrange tasks">
          <button type="button" aria-label="Toggle side panel" aria-pressed={cal.arrangeOpen} onClick={() => setCal({ arrangeOpen: !cal.arrangeOpen })} className={`btn btn-ghost icon-btn ${cal.arrangeOpen ? "is-on" : ""}`}>
            <PanelRight size={16} strokeWidth={1.75} />
          </button>
          </Tip>
          {options.open && (
            <Popover anchor={options.anchor} onClose={options.close} align="end" className="w-60 p-2">
              <MenuLabel>Color by</MenuLabel>
              <div className="seg mx-1.5 mb-1 flex">
                {(["list", "priority", "tag"] as const).map((c) => (
                  <button key={c} type="button" onClick={() => setCal({ colorBy: c })} className={`seg-item flex-1 justify-center capitalize ${cal.colorBy === c ? "is-on" : ""}`}>
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
                <div key={k} className="menu-item justify-between">
                  {label}
                  <Switch checked={cal[k]} onChange={(v) => setCal({ [k]: v })} label={label} />
                </div>
              ))}
              <MenuSeparator />
              <MenuLabel>Density</MenuLabel>
              <div className="seg mx-1.5 mb-1 flex">
                {(["comfortable", "compact"] as const).map((d) => (
                  <button key={d} type="button" onClick={() => setCal({ density: d })} className={`seg-item flex-1 justify-center capitalize ${cal.density === d ? "is-on" : ""}`}>
                    {d}
                  </button>
                ))}
              </div>
              <p className="px-2 pt-1 text-[length:var(--fs-xs)] text-muted">Week start and 12/24-hour time are in Settings.</p>
            </Popover>
          )}
        </div>
        </ToolbarActions>
        {span ? (
          <TimeGrid days={days} items={items} onViewDay={openDay} />
        ) : view === "month" ? (
          <MonthView days={days} anchor={anchor} items={items} weekStart={settings.weekStart} onViewDay={openDay} />
        ) : view === "agenda" ? (
          <AgendaView days={days} items={items} />
        ) : view === "day" ? (
          // Grid plus the Day brief, or the grid up to the Arrange panel: both sides filled, never a centred island (D209).
          <div className="flex min-h-0 flex-1">
            <TimeGrid days={days} items={items} onViewDay={openDay} />
            {!cal.arrangeOpen && <DayBrief day={days[0]} items={items} />}
          </div>
        ) : (
          <TimeGrid days={days} items={items} onViewDay={openDay} />
        )}
      </div>
      {cal.arrangeOpen && <SidePanel weekStart={settings.weekStart} visible={days} />}
    </div>
  );
}
