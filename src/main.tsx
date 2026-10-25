import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/jetbrains-mono/400.css";
import "./styles/tokens.css";
import { isTauri } from "./db/client";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const popup = new URLSearchParams(location.search).get("window");

if (popup === "quickadd" || popup === "reminder") {
  // Small helper windows: no database, no stores; they talk to the main window via events.
  const { QuickAddWindow } = await import("./windows/QuickAddWindow");
  const { ReminderWindow } = await import("./windows/ReminderWindow");
  root.render(<React.StrictMode>{popup === "quickadd" ? <QuickAddWindow /> : <ReminderWindow />}</React.StrictMode>);
} else {
  const [{ default: App }, data, habits, focus, countdowns, { useSettings }, { go }, { initOs }] = await Promise.all([
    import("./App"),
    import("./stores/data"),
    import("./stores/habits"),
    import("./stores/focus"),
    import("./stores/countdowns"),
    import("./stores/settings"),
    import("./stores/ui"),
    import("./lib/os"),
  ]);
  // Hydrate before first paint so the saved theme applies without a flash.
  await Promise.all([useSettings.getState().hydrate(), data.hydrate(), habits.hydrateHabits(), focus.hydrateFocus(), countdowns.hydrateCountdowns()]);
  if (!isTauri && import.meta.env.DEV && !Object.keys(data.useData.getState().tasks).length) {
    // Plain-browser dev mode has no database: show sample data so the UI is populated.
    const seed = await import("./dev/seed");
    data.replaceAll(seed.sampleWorkspace());
    habits.replaceHabits(seed.sampleHabits());
    countdowns.replaceCountdowns(seed.sampleCountdowns());
    focus.replaceSessions(seed.sampleFocus(Object.values(data.useData.getState().tasks)));
  }
  go(useSettings.getState().settings.defaultView);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  void initOs();
}
