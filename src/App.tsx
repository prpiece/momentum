import { useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { ContextMenu } from "./components/ui/ContextMenu";
import { EmptyState } from "./components/ui/EmptyState";
import { Toaster } from "./components/ui/Toaster";
import { TOOLBAR_SLOT_ID } from "./components/ui/Toolbar";
import { CelebrationOverlay } from "./features/celebrate/CelebrationOverlay";
import { UpdatePrompt } from "./features/shell/UpdatePrompt";
import { WhatsNew } from "./features/shell/WhatsNew";
import { onWriteError } from "./db/client";
import type { Folder, ViewId } from "./domain/types";
import { CalendarView } from "./features/calendar/CalendarView";
import { EventDialog } from "./features/calendar/EventDialog";
import { FocusView } from "./features/focus/FocusView";
import { HabitsView } from "./features/habits/HabitsView";
import { ProgressView } from "./features/progress/ProgressView";
import { SettingsView } from "./features/settings/SettingsView";
import { CommandPalette } from "./features/shell/CommandPalette";
import { ConfirmDialog, ScopeDialog, ShortcutSheet } from "./features/shell/Dialogs";
import { ImportDialog } from "./features/tasks/ImportDialog";
import { navFor } from "./features/shell/nav";
import { NavBar } from "./features/shell/NavBar";
import { PhoneBar } from "./features/shell/PhoneBar";
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


function View({ view, spec }: { view: ViewId; spec: TaskViewSpec | null }) {
  if (view === "settings") return <SettingsView />;
  if (view === "calendar") return <CalendarView />;
  if (view === "habits") return <HabitsView />;
  if (view === "progress") return <ProgressView />;
  if (view === "focus") return <FocusView />;
  if (spec) return <TaskView spec={spec} />;
  const nav = navFor(view);
  return (
    <EmptyState icon={nav.icon} title={nav.label}>
      This list or tag no longer exists.
    </EmptyState>
  );
}

/** Where a view sits, for the toolbar's breadcrumb: a list's folder, or the kind of view. */
function crumbParent(view: ViewId, spec: TaskViewSpec | null, folders: Record<string, Folder>): string | null {
  if (spec?.list && spec.list.id !== "inbox") return (spec.list.folderId && folders[spec.list.folderId]?.name) || "Lists";
  if (view.startsWith("tag:")) return "Tags";
  if (view.startsWith("filter:")) return "Filters";
  return null;
}

function Header({ view, spec, controls }: { view: ViewId; spec: TaskViewSpec | null; controls: "always" | "phone" }) {
  const folders = useData((s) => s.folders);
  const parent = crumbParent(view, spec, folders);
  return (
    // The toolbar (D198). Also the window's title bar: drag to move, double-click to maximize (children pass clicks through).
    <header data-tauri-drag-region className="flex h-12 shrink-0 select-none items-center gap-1.5 border-b border-border pl-6 pr-3">
      <h1 className="pointer-events-none flex max-w-[50%] shrink-0 items-center gap-1 text-[length:var(--fs-sm)] text-muted">
        {parent && (
          <>
            <span className="truncate">{parent}</span>
            <ChevronRight size={14} aria-hidden />
          </>
        )}
        <b className="truncate font-semibold text-fg">{spec?.title ?? navFor(view).label}</b>
      </h1>
      {/* The slot takes what the title and the window controls leave and scrolls when its content is wider (D202). */}
      <div id={TOOLBAR_SLOT_ID} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [justify-content:safe_flex-end] [scrollbar-width:none]" />
      {/* With the bar at the top, the controls are in the bar, except below 720px where the bar hides. */}
      {controls === "always" ? <WindowControls /> : <span className="contents min-[720px]:hidden"><WindowControls /></span>}
    </header>
  );
}

export default function App() {
  useApplySettings();
  useGlobalShortcuts();
  useEffect(() => onWriteError(() => toast("Couldn't save a change. It will be lost if you close the app.")), []);
  const side = useSettings((s) => s.settings.sidebarSide);
  const layout = useSettings((s) => s.settings.layout);
  const barPosition = useSettings((s) => s.settings.barPosition);
  const topBar = layout === "bar" && barPosition === "top";
  const view = useUi((s) => s.view);
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const savedFilters = useSettings((s) => s.settings.savedFilters);
  const spec = taskViewSpec(view, lists, tags, savedFilters);

  return (
    <DndRoot>
      {/* Below 720px the sidebar or bar hides and the phone bar sits under the content (D200). */}
      <div className="flex h-full flex-col">
      <div className={`relative isolate flex min-h-0 flex-1 ${layout === "bar" ? "flex-col" : side === "right" ? "flex-row-reverse" : ""}`}>
        <div className="contents max-[719px]:hidden">{layout === "sidebar" ? <Sidebar /> : topBar && <NavBar position="top" />}</div>
        <main className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface border-border max-[719px]:border-0 ${layout === "sidebar" ? (side === "left" ? "border-l" : "border-r") : topBar ? "border-t" : "border-b"}`}>
          <Header view={view} spec={spec} controls={topBar ? "phone" : "always"} />
          <div key={view} className="anim-view flex min-h-0 flex-1 flex-col overflow-auto">
            <View view={view} spec={spec} />
          </div>
        </main>
        <div className="contents max-[719px]:hidden">{layout === "bar" && !topBar && <NavBar position="bottom" />}</div>
        <TaskDrawer />
      </div>
      <div className="min-[720px]:hidden">
        <PhoneBar />
      </div>
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
