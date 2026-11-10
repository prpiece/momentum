import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles/tokens.css";
import { isTauri } from "./db/client";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const popup = new URLSearchParams(location.search).get("window");

if (popup === "mini") {
  const { MiniWindow } = await import("./windows/MiniWindow");
  root.render(<React.StrictMode><MiniWindow /></React.StrictMode>);
} else if (popup === "quickadd" || popup === "reminder") {
  // Small helper windows: no database, no stores; they talk to the main window via events.
  const { QuickAddWindow } = await import("./windows/QuickAddWindow");
  const { ReminderWindow } = await import("./windows/ReminderWindow");
  root.render(<React.StrictMode>{popup === "quickadd" ? <QuickAddWindow /> : <ReminderWindow />}</React.StrictMode>);
} else {
  const [{ default: App }, data, habits, focus, progress, { useSettings }, { go }, { initOs }] = await Promise.all([
    import("./App"),
    import("./stores/data"),
    import("./stores/habits"),
    import("./stores/focus"),
    import("./stores/progress"),
    import("./stores/settings"),
    import("./stores/ui"),
    import("./lib/os"),
  ]);
  // Hydrate before first paint so the saved theme applies without a flash.
  await Promise.all([useSettings.getState().hydrate(), data.hydrate(), habits.hydrateHabits(), focus.hydrateFocus(), progress.hydrateProgress()]);
  if (!isTauri && import.meta.env.DEV && !Object.keys(data.useData.getState().tasks).length) {
    // Plain-browser dev mode has no database: show sample data so the UI is populated.
    const seed = await import("./dev/seed");
    data.replaceAll(seed.sampleWorkspace());
    habits.replaceHabits(seed.sampleHabits());
    focus.replaceSessions(seed.sampleFocus(Object.values(data.useData.getState().tasks)));
  }
  if (isTauri) void import("./lib/sync/engine").then((s) => s.startSync());
  // Old unreferenced note images are cleaned up in the background (D78).
  void import("./lib/appFiles").then((f) => f.sweepAttachments(Object.values(data.useData.getState().tasks).map((t) => t.description))).catch(console.error);
  go(useSettings.getState().settings.defaultView);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  void initOs();
}
