import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles/tokens.css";
import { invoke } from "@tauri-apps/api/core";
import { isTauri, setDriver } from "./db/client";
import { configureSync } from "./lib/sync/supabase";
import { installLinkGuard } from "./lib/links";

// Opening the database runs the migrations registered in src-tauri/src/lib.rs.
if (isTauri) {
  setDriver(async () => (await import("@tauri-apps/plugin-sql")).default.load("sqlite:momentum.db"));
  // The refresh token lives in the OS keychain behind three Rust commands limited to this one key (D226).
  configureSync(import.meta.env.VITE_SUPABASE_URL as string | undefined, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined, {
    get: () => invoke<string | null>("secret_get", { key: "refresh_token" }),
    set: (value) => invoke("secret_set", { key: "refresh_token", value }),
    delete: () => invoke("secret_delete", { key: "refresh_token" }),
  });
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
installLinkGuard();
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
  const [{ default: App }, data, habits, focus, { useSettings }, { go }, { initOs }] = await Promise.all([
    import("./App"),
    import("./stores/data"),
    import("./stores/habits"),
    import("./stores/focus"),
    import("./stores/settings"),
    import("./stores/ui"),
    import("./lib/os"),
  ]);
  // Hydrate before first paint so the saved theme applies without a flash.
  try {
    await Promise.all([useSettings.getState().hydrate(), data.hydrate(), habits.hydrateHabits(), focus.hydrateFocus()]);
  } catch (e) {
    // A failed migration or a database from a newer version would otherwise leave a blank window (RUST-06).
    const dir = isTauri ? await invoke<string>("backups_dir").catch(() => "") : "";
    const box = document.getElementById("root") as HTMLElement;
    box.style.cssText = "padding:32px;font:14px system-ui;max-width:640px";
    box.replaceChildren();
    const h = document.createElement("h1");
    h.textContent = "Momentum could not open its database";
    const p = document.createElement("p");
    p.textContent = String(e instanceof Error ? e.message : e) + (dir ? " Your pre-update backups are in: " + dir : "");
    const b = document.createElement("button");
    b.textContent = "Quit";
    b.onclick = () => void invoke("quit_app");
    box.append(h, p, b);
    throw e;
  }
  if (isTauri)
    void import("./stores/subscriptions").then(async (s) => {
      s.setFeedFetcher(async (url) => (await import("@tauri-apps/api/core")).invoke<string>("fetch_ics", { url }));
      await s.hydrateSubscriptions();
      s.startSubscriptionRefresh();
    });
  if (!isTauri && import.meta.env.DEV && !Object.keys(data.useData.getState().tasks).length) {
    // Plain-browser dev mode has no database: show sample data so the UI is populated.
    const seed = await import("./dev/seed");
    data.replaceAll(seed.sampleWorkspace());
    habits.replaceHabits(seed.sampleHabits());
    focus.replaceSessions(seed.sampleFocus(Object.values(data.useData.getState().tasks)));
  }
  if (isTauri)
    void import("./lib/sync/engine").then((s) => {
      s.setSnapshot((reason) => import("./db/backup").then((b) => b.snapshotDatabase(reason)));
      const ua = navigator.userAgent;
      s.setSyncHost({
        platform: /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null,
        online: () => navigator.onLine,
        watch: (sync) => {
          window.addEventListener("online", sync);
          return () => window.removeEventListener("online", sync);
        },
      });
      void import("./features/friends/boot").then((b) => b.startFriends());
      return s.startSync();
    });
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
