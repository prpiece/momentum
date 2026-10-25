import { EmptyState } from "./components/ui/EmptyState";
import type { ViewId } from "./domain/types";
import { SettingsView } from "./features/settings/SettingsView";
import { navFor } from "./features/shell/nav";
import { Sidebar } from "./features/shell/Sidebar";
import { useApplySettings } from "./lib/applySettings";
import { useSettings } from "./stores/settings";
import { useUi } from "./stores/ui";

// ponytail: placeholder screens; each phase replaces its entry with the real view.
const ARRIVES_IN: Record<Exclude<ViewId, "settings">, number> = {
  inbox: 2, today: 2, tomorrow: 2, next7: 2, overdue: 2, unscheduled: 2, high: 2, completed: 2, wontdo: 2,
  calendar: 3, matrix: 4, habits: 5, focus: 6, countdown: 6,
};

function View({ view }: { view: ViewId }) {
  if (view === "settings") return <SettingsView />;
  const nav = navFor(view);
  return (
    <EmptyState icon={nav.icon} title={nav.label}>
      This view arrives in Phase {ARRIVES_IN[view]}.
    </EmptyState>
  );
}

export default function App() {
  useApplySettings();
  const side = useSettings((s) => s.settings.sidebarSide);
  const view = useUi((s) => s.view);
  const nav = navFor(view);

  return (
    <div className={`flex h-full ${side === "right" ? "flex-row-reverse" : ""}`}>
      <Sidebar />
      {/* The task drawer (Phase 2) docks on the side opposite the sidebar. */}
      <main
        className={`my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm ${
          side === "left" ? "mr-2" : "ml-2"
        }`}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
          <nav.icon size={20} className="text-accent" />
          <h1 className="text-lg font-semibold tracking-tight">{nav.label}</h1>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <View view={view} />
        </div>
      </main>
    </div>
  );
}
