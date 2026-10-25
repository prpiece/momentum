import { useEffect } from "react";
import { EmptyState } from "./components/ui/EmptyState";
import { Toaster } from "./components/ui/Toaster";
import { onWriteError } from "./db/client";
import type { ViewId } from "./domain/types";
import { CalendarView } from "./features/calendar/CalendarView";
import { EventDialog } from "./features/calendar/EventDialog";
import { SettingsView } from "./features/settings/SettingsView";
import { CommandPalette } from "./features/shell/CommandPalette";
import { ConfirmDialog, ScopeDialog, ShortcutSheet } from "./features/shell/Dialogs";
import { navFor } from "./features/shell/nav";
import { Sidebar } from "./features/shell/Sidebar";
import { TaskDrawer } from "./features/tasks/TaskDrawer";
import { TaskView } from "./features/tasks/TaskView";
import { taskViewSpec, type TaskViewSpec } from "./features/tasks/viewSpec";
import { useApplySettings } from "./lib/applySettings";
import { DndRoot } from "./lib/dnd";
import { useGlobalShortcuts } from "./lib/shortcuts";
import { useData } from "./stores/data";
import { useSettings } from "./stores/settings";
import { toast, useUi } from "./stores/ui";

// ponytail: placeholder screens; each phase replaces its entry with the real view.
const ARRIVES_IN: Partial<Record<ViewId, number>> = { matrix: 4, habits: 5, stats: 5, focus: 6, countdown: 6 };

function View({ view, spec }: { view: ViewId; spec: TaskViewSpec | null }) {
  if (view === "settings") return <SettingsView />;
  if (view === "calendar") return <CalendarView />;
  if (spec) return <TaskView spec={spec} />;
  const nav = navFor(view);
  return (
    <EmptyState icon={nav.icon} title={nav.label}>
      {ARRIVES_IN[view] ? `This view arrives in Phase ${ARRIVES_IN[view]}.` : "This list no longer exists."}
    </EmptyState>
  );
}

function Header({ view, spec }: { view: ViewId; spec: TaskViewSpec | null }) {
  const nav = navFor(view);
  const Icon = spec?.icon ?? nav.icon;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-6">
      {spec?.list?.emoji && spec.list.id !== "inbox" ? (
        <span className="text-xl">{spec.list.emoji}</span>
      ) : (
        <Icon size={20} className="text-accent" style={spec?.list?.color ? { color: spec.list.color } : undefined} />
      )}
      <h1 className="truncate text-lg font-semibold tracking-tight">{spec?.title ?? nav.label}</h1>
    </header>
  );
}

export default function App() {
  useApplySettings();
  useGlobalShortcuts();
  useEffect(() => onWriteError(() => toast("Couldn't save a change. It will be lost if you close the app.")), []);
  const side = useSettings((s) => s.settings.sidebarSide);
  const view = useUi((s) => s.view);
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const spec = taskViewSpec(view, lists, tags);

  return (
    <DndRoot>
      <div className={`relative flex h-full ${side === "right" ? "flex-row-reverse" : ""}`}>
        <Sidebar />
        <main className={`relative my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm ${side === "left" ? "mr-2" : "ml-2"}`}>
          <Header view={view} spec={spec} />
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <View view={view} spec={spec} />
          </div>
        </main>
        <TaskDrawer />
      </div>
      <CommandPalette />
      <ShortcutSheet />
      <ScopeDialog />
      <ConfirmDialog />
      <EventDialog />
      <Toaster />
    </DndRoot>
  );
}
