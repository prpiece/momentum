import {
  AlarmClock,
  CalendarDays,
  ChartColumn,
  CalendarRange,
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
];
export const SIDEBAR_SMART_NAV = SMART_LIST_NAV;

export const MODULE_NAV: NavDef<Exclude<ModuleView, "settings">>[] = [
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "habits", label: "Habits", icon: Target },
  { id: "focus", label: "Focus", icon: AlarmClock },
  { id: "progress", label: "Progress", icon: ChartColumn },
];



export const SETTINGS_NAV: NavDef<"settings"> = { id: "settings", label: "Settings", icon: Settings };

const ALL = [...SMART_LIST_NAV, ...MODULE_NAV, SETTINGS_NAV];
export const navFor = (id: ViewId) => ALL.find((n) => n.id === id) ?? SMART_LIST_NAV[1];
