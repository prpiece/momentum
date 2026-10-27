import {
  AlarmClock,
  CalendarDays,
  ChartColumn,
  CalendarRange,
  CircleCheckBig,
  Grid2x2,
  Hourglass,
  Inbox,
  type LucideIcon,
  Settings,
  Sun,
  Target,
} from "lucide-react";
import type { ModuleView, SmartListId, ViewId } from "../../domain/types";

type NavDef<T extends ViewId> = { id: T; label: string; icon: LucideIcon };

export const SMART_LIST_NAV: NavDef<SmartListId>[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "today", label: "Today", icon: Sun },
  { id: "upcoming", label: "Upcoming", icon: CalendarRange },
  { id: "logbook", label: "Logbook", icon: CircleCheckBig },
];
/** Logbook stays off the sidebar. */
export const SIDEBAR_SMART_NAV = SMART_LIST_NAV.filter((n) => n.id !== "logbook");

export const MODULE_NAV: NavDef<Exclude<ModuleView, "settings">>[] = [
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "matrix", label: "Matrix", icon: Grid2x2 },
  { id: "habits", label: "Habits", icon: Target },
  { id: "focus", label: "Focus", icon: AlarmClock },
  { id: "countdown", label: "Countdown", icon: Hourglass },
  { id: "stats", label: "Statistics", icon: ChartColumn },
];

/** Calendar stays in the sidebar; the other modules sit in the collapsible "More" group. */
export const MORE_NAV = MODULE_NAV.filter((n) => n.id !== "calendar");
export const PRIMARY_MODULE_NAV = MODULE_NAV.filter((n) => n.id === "calendar");

export const SETTINGS_NAV: NavDef<"settings"> = { id: "settings", label: "Settings", icon: Settings };

const ALL = [...SMART_LIST_NAV, ...MODULE_NAV, SETTINGS_NAV];
export const navFor = (id: ViewId) => ALL.find((n) => n.id === id) ?? SMART_LIST_NAV[1];
