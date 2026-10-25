import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/jetbrains-mono/400.css";
import "./styles/tokens.css";
import App from "./App";
import { isTauri } from "./db/client";
import { hydrate, replaceAll, useData } from "./stores/data";
import { useSettings } from "./stores/settings";
import { go } from "./stores/ui";

// Hydrate before first paint so the saved theme applies without a flash.
await Promise.all([useSettings.getState().hydrate(), hydrate()]);
if (!isTauri && import.meta.env.DEV && !Object.keys(useData.getState().tasks).length) {
  // Plain-browser dev mode has no database: show sample data so the UI is populated.
  const { sampleWorkspace } = await import("./dev/seed");
  replaceAll(sampleWorkspace());
}
go(useSettings.getState().settings.defaultView);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
