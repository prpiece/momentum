import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/jetbrains-mono/400.css";
import "./styles/tokens.css";
import App from "./App";
import { useSettings } from "./stores/settings";
import { useUi } from "./stores/ui";

// Hydrate before first paint so the saved theme applies without a flash.
await useSettings.getState().hydrate();
useUi.getState().go(useSettings.getState().settings.defaultView);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
