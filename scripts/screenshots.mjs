// Regenerates the README screenshots in docs/screenshots from the browser build with the dev seed.
// Usage: npm run screenshots (uses the installed Microsoft Edge, so no browser download).
import { createServer } from "vite";
import { chromium } from "playwright-core";

const PORT = 1431;
const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ channel: "msedge" });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector("main");

  // Drive the app through its own stores; Vite serves the same module instances the app uses.
  const run = (fn, arg) => page.evaluate(fn, arg);
  const settle = () => page.waitForTimeout(900);
  const shot = async (name, setup) => {
    await run(setup);
    await page.mouse.move(0, 799);
    await settle();
    await page.screenshot({ path: `docs/screenshots/${name}.png` });
    console.log(`docs/screenshots/${name}.png`);
  };
  const app = `
    const { useSettings } = await import("/src/stores/settings.ts");
    const ui = await import("/src/stores/ui.ts");
    const { useData } = await import("/src/stores/data.ts");
    const set = useSettings.getState().update;
    const s = () => useSettings.getState().settings;
  `;
  const view = (theme, v, extra = "") =>
    new Function(`return (async () => { ${app} set({ onboarded: true, theme: "${theme}" }); ui.go(${v}); ${extra} ui.useUi.setState({ toasts: [] }); })()`);

  // Light by default: easier to read (D97). One dark shot shows dark mode exists.
  await shot("today", view("light", '"today"'));
  await shot(
    "list-drawer",
    view(
      "light",
      '"list:" + Object.values(useData.getState().lists).find((l) => l.name === "Chemistry").id',
      'await new Promise((r) => setTimeout(r, 50)); ui.openTask(Object.values(useData.getState().tasks).find((t) => t.title === "Write up titration lab").id);',
    ),
  );
  await shot("calendar", view("light", '"calendar"', 'set({ calendar: { ...s().calendar, view: "week" } });'));
  await shot("calendar-month", view("light", '"calendar"', 'set({ calendar: { ...s().calendar, view: "month" } });'));
  // Matrix is a view mode since D164/D193: Chemistry in Matrix mode.
  await shot(
    "matrix",
    view(
      "light",
      '"list:" + Object.values(useData.getState().lists).find((l) => l.name === "Chemistry").id',
      'const vo = await import("/src/features/tasks/viewOptions.ts"); vo.setViewOptions(ui.useUi.getState().view, { mode: "matrix" });',
    ),
  );
  await shot("habits", view("light", '"habits"'));
  await shot("focus", view("light", '"focus"'));
  await shot("progress", view("light", '"progress"'));
  await shot("settings", view("light", '"settings"'));
  await shot("layout-bar-top", view("light", '"today"', 'set({ layout: "bar", barPosition: "top" });'));
  await shot("layout-bar-bottom", view("light", '"calendar"', 'set({ layout: "bar", barPosition: "bottom", calendar: { ...s().calendar, view: "week" } });'));
  // The guided tour on its quick-add step: restart it, then step forward.
  await run(view("light", '"today"', 'set({ layout: "sidebar", onboarded: false });'));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await shot("tour", () => {});
  // The phone layout (D200), then back to the desktop size.
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("today-phone", view("light", '"today"', 'ui.useUi.setState({ tourOpen: false });'));
  await page.setViewportSize({ width: 1280, height: 800 });
  // Last, so the theme switch doesn't bleed into a light shot.
  await shot("today-dark", view("dark", '"today"', 'useSettings.setState({}); ui.useUi.setState({ tourOpen: false });'));
} finally {
  await browser.close();
  await server.close();
}
