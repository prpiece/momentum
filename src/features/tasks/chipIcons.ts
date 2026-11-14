import { Archive, CalendarCheck, CalendarDays, Flag, Hash, Hourglass, List, Repeat, Timer, type LucideIcon } from "lucide-react";
import type { ChipKind } from "../../domain/quickAdd";

/** The icon on each quick-add token chip (main window and the popup). */
export const CHIP_ICON: Record<ChipKind, LucideIcon> = {
  date: CalendarDays,
  priority: Flag,
  tag: Hash,
  list: List,
  repeat: Repeat,
  deadline: CalendarCheck,
  duration: Timer,
  someday: Archive,
  waiting: Hourglass,
};
