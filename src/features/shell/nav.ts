import {
  AlarmClock,
  Archive,
  BookOpen,
  ClipboardCheck,
  Hourglass,
  House,
  CalendarDays,
  ChartColumn,
  CalendarRange,
  Inbox,
  type LucideIcon,
  Settings,
  Sun,
  Target,
  Trash2,
  Users,
} from "lucide-react";
import type { ModuleView, SmartListId, ViewId } from "../../domain/types";

type NavDef<T extends ViewId> = { id: T; label: string; icon: LucideIcon };

export const SMART_LIST_NAV: NavDef<SmartListId>[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "today", label: "Today", icon: Sun },
  { id: "upcoming", label: "Upcoming", icon: CalendarRange },
  { id: "someday", label: "Someday", icon: Archive },
  { id: "waiting", label: "Waiting", icon: Hourglass },
];
export const SIDEBAR_SMART_NAV = SMART_LIST_NAV;

export const HOME_NAV: NavDef<"home"> = { id: "home", label: "Home", icon: House };

export const MODULE_NAV: NavDef<Exclude<ModuleView, "settings" | "home">>[] = [
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "habits", label: "Habits", icon: Target },
  { id: "focus", label: "Focus", icon: AlarmClock },
  { id: "progress", label: "Progress", icon: ChartColumn },
  { id: "friends", label: "Friends", icon: Users },
  { id: "review", label: "Review", icon: ClipboardCheck },
  { id: "logbook", label: "Logbook", icon: BookOpen },
  { id: "trash", label: "Trash", icon: Trash2 },
];

/** Rarely opened destinations the sidebar folds under "More" (they stay in the palette and on Home). */
export const SIDEBAR_MORE: readonly ViewId[] = ["someday", "waiting", "progress", "review", "logbook", "trash"];

export const SETTINGS_NAV: NavDef<"settings"> = { id: "settings", label: "Settings", icon: Settings };

const ALL = [HOME_NAV, ...SMART_LIST_NAV, ...MODULE_NAV, SETTINGS_NAV];
export const navFor = (id: ViewId) => ALL.find((n) => n.id === id) ?? SMART_LIST_NAV[1];
