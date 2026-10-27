import { useEffect } from "react";
import { ListGlyph } from "./components/ui/AppIcon";
import { ContextMenu } from "./components/ui/ContextMenu";
import { EmptyState } from "./components/ui/EmptyState";
import { Toaster } from "./components/ui/Toaster";
import { onWriteError } from "./db/client";
import type { ViewId } from "./domain/types";
import { CalendarView } from "./features/calendar/CalendarView";
import { EventDialog } from "./features/calendar/EventDialog";
import { CountdownView } from "./features/countdown/CountdownView";
import { FocusView } from "./features/focus/FocusView";
import { HabitsView } from "./features/habits/HabitsView";
import { MatrixView } from "./features/matrix/MatrixView";
import { StatsView } from "./features/stats/StatsView";
import { SettingsView } from "./features/settings/SettingsView";
import { CommandPalette } from "./features/shell/CommandPalette";
import { ConfirmDialog, ScopeDialog, ShortcutSheet } from "./features/shell/Dialogs";
import { navFor } from "./features/shell/nav";
import { Sidebar } from "./features/shell/Sidebar";
import { Welcome } from "./features/shell/Welcome";
import { WindowControls } from "./features/shell/WindowControls";
import { TaskDrawer } from "./features/tasks/TaskDrawer";
import { TaskView } from "./features/tasks/TaskView";
import { taskViewSpec, type TaskViewSpec } from "./features/tasks/viewSpec";
import { useApplySettings } from "./lib/applySettings";
import { DndRoot } from "./lib/dnd";
import { useGlobalShortcuts } from "./lib/shortcuts";
import { useData } from "./stores/data";
import { useSettings } from "./stores/settings";
import { toast, useUi } from "./stores/ui";


function View({ view, spec }: { view: ViewId; spec: TaskViewSpec | null }) {
  if (view === "settings") return <SettingsView />;
  if (view === "calendar") return <CalendarView />;
  if (view === "matrix") return <MatrixView />;
  if (view === "habits") return <HabitsView />;
  if (view === "stats") return <StatsView />;
  if (view === "focus") return <FocusView />;
  if (view === "countdown") return <CountdownView />;
  if (spec) return <TaskView spec={spec} />;
  const nav = navFor(view);
  return (
    <EmptyState icon={nav.icon} title={nav.label}>
      This list or tag no longer exists.
    </EmptyState>
  );
}

function Header({ view, spec }: { view: ViewId; spec: TaskViewSpec | null }) {
  const nav = navFor(view);
  const Icon = spec?.icon ?? nav.icon;
  return (
    // Also the window's title bar: drag to move, double-click to maximize (children pass clicks through).
    <header data-tauri-drag-region className="flex h-14 shrink-0 select-none items-center gap-3 pl-6 pr-3 [&>:not(:last-child)]:pointer-events-none">
      {spec?.list?.icon && spec.list.id !== "inbox" ? (
        <ListGlyph icon={spec.list.icon} color={spec.list.color} size={20} />
      ) : (
        <Icon size={20} className="text-accent" style={spec?.list?.color ? { color: spec.list.color } : undefined} />
      )}
      <h1 className="truncate text-lg font-semibold tracking-tight">{spec?.title ?? nav.label}</h1>
      <WindowControls />
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
  const savedFilters = useSettings((s) => s.settings.savedFilters);
  const spec = taskViewSpec(view, lists, tags, savedFilters);

  return (
    <DndRoot>
      <div className={`relative flex h-full ${side === "right" ? "flex-row-reverse" : ""}`}>
        <Sidebar />
        <main className={`relative my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm ${side === "left" ? "mr-2" : "ml-2"}`}>
          <Header view={view} spec={spec} />
          <div key={view} className="anim-view flex min-h-0 flex-1 flex-col overflow-auto">
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
      <ContextMenu />
      <Welcome />
      <Toaster />
    </DndRoot>
  );
}
