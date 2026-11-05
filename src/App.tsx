import { useEffect } from "react";
import { ListGlyph } from "./components/ui/AppIcon";
import { ContextMenu } from "./components/ui/ContextMenu";
import { EmptyState } from "./components/ui/EmptyState";
import { Toaster } from "./components/ui/Toaster";
import { CelebrationOverlay } from "./features/celebrate/CelebrationOverlay";
import { UpdatePrompt } from "./features/shell/UpdatePrompt";
import { WhatsNew } from "./features/shell/WhatsNew";
import { onWriteError } from "./db/client";
import type { Layout, ViewId } from "./domain/types";
import { CalendarView } from "./features/calendar/CalendarView";
import { EventDialog } from "./features/calendar/EventDialog";
import { CountdownView } from "./features/countdown/CountdownView";
import { FocusView } from "./features/focus/FocusView";
import { HabitsView } from "./features/habits/HabitsView";
import { MatrixView } from "./features/matrix/MatrixView";
import { StatsView } from "./features/stats/StatsView";
import { SettingsView } from "./features/settings/SettingsView";
import { BackgroundLayer } from "./features/shell/BackgroundLayer";
import { CommandPalette } from "./features/shell/CommandPalette";
import { ConfirmDialog, ScopeDialog, ShortcutSheet } from "./features/shell/Dialogs";
import { ImportDialog } from "./features/tasks/ImportDialog";
import { navFor } from "./features/shell/nav";
import { NavBar } from "./features/shell/NavBar";
import { Sidebar } from "./features/shell/Sidebar";
import { Tour } from "./features/shell/Tour";
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


/** The content card's frame per layout (D68). Flat runs edge to edge with one divider. */
const MAIN: Record<Layout, string> = {
  classic: "my-2 rounded-lg border border-border shadow-sm",
  flat: "border-border",
  topbar: "mx-2 mb-2 rounded-lg border border-border shadow-sm",
  dock: "m-2 rounded-lg border border-border shadow-sm",
};

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

function Header({ view, spec, controls }: { view: ViewId; spec: TaskViewSpec | null; controls: boolean }) {
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
      {/* The top bar layout has them in the bar. */}
      {controls && <WindowControls />}
    </header>
  );
}

export default function App() {
  useApplySettings();
  useGlobalShortcuts();
  useEffect(() => onWriteError(() => toast("Couldn't save a change. It will be lost if you close the app.")), []);
  const side = useSettings((s) => s.settings.sidebarSide);
  const layout = useSettings((s) => s.settings.layout);
  const view = useUi((s) => s.view);
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const savedFilters = useSettings((s) => s.settings.savedFilters);
  const spec = taskViewSpec(view, lists, tags, savedFilters);

  return (
    <DndRoot>
      <div className={`relative isolate flex h-full ${layout === "topbar" || layout === "dock" ? "flex-col" : side === "right" ? "flex-row-reverse" : ""}`}>
        <BackgroundLayer />
        {layout === "topbar" ? <NavBar variant="top" /> : layout !== "dock" && <Sidebar />}
        <main className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface ${MAIN[layout]} ${layout === "classic" ? (side === "left" ? "mr-2" : "ml-2") : layout === "flat" ? (side === "left" ? "border-l" : "border-r") : ""}`}>
          <Header view={view} spec={spec} controls={layout !== "topbar"} />
          <div key={view} className="anim-view flex min-h-0 flex-1 flex-col overflow-auto">
            <View view={view} spec={spec} />
          </div>
        </main>
        {layout === "dock" && <NavBar variant="dock" />}
        <TaskDrawer />
      </div>
      <CommandPalette />
      <ShortcutSheet />
      <ImportDialog />
      <ScopeDialog />
      <ConfirmDialog />
      <EventDialog />
      <ContextMenu />
      <Tour />
      <Toaster />
      <CelebrationOverlay />
      <WhatsNew />
      <UpdatePrompt />
    </DndRoot>
  );
}
