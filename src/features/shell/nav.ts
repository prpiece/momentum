import {
  AlarmClock,
  Ban,
  CalendarDays,
  ChartColumn,
  CalendarRange,
  CircleCheckBig,
  Flag,
  Grid2x2,
  Hourglass,
  Inbox,
  type LucideIcon,
  Settings,
  Sun,
  Sunrise,
  Target,
  TriangleAlert,
  CircleDashed,
} from "lucide-react";
import type { ModuleView, SmartListId, ViewId } from "../../domain/types";

type NavDef<T extends ViewId> = { id: T; label: string; icon: LucideIcon };

export const SMART_LIST_NAV: NavDef<SmartListId>[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "today", label: "Today", icon: Sun },
  { id: "tomorrow", label: "Tomorrow", icon: Sunrise },
  { id: "next7", label: "Next 7 Days", icon: CalendarRange },
  { id: "overdue", label: "Overdue", icon: TriangleAlert },
  { id: "unscheduled", label: "Unscheduled", icon: CircleDashed },
  { id: "high", label: "High Priority", icon: Flag },
  { id: "completed", label: "Completed", icon: CircleCheckBig },
  { id: "wontdo", label: "Won't Do", icon: Ban },
];

export const MODULE_NAV: NavDef<Exclude<ModuleView, "settings">>[] = [
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "matrix", label: "Matrix", icon: Grid2x2 },
  { id: "habits", label: "Habits", icon: Target },
  { id: "focus", label: "Focus", icon: AlarmClock },
  { id: "countdown", label: "Countdown", icon: Hourglass },
  { id: "stats", label: "Statistics", icon: ChartColumn },
];

export const SETTINGS_NAV: NavDef<"settings"> = { id: "settings", label: "Settings", icon: Settings };

const ALL = [...SMART_LIST_NAV, ...MODULE_NAV, SETTINGS_NAV];
export const navFor = (id: ViewId) => ALL.find((n) => n.id === id) ?? SMART_LIST_NAV[1];
