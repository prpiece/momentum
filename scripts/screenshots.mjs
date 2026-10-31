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

  await shot("today", view("dark", '"today"'));
  await shot(
    "list-drawer",
    view(
      "dark",
      '"list:" + Object.values(useData.getState().lists).find((l) => l.name === "Chemistry").id',
      'await new Promise((r) => setTimeout(r, 50)); ui.openTask(Object.values(useData.getState().tasks).find((t) => t.title === "Write up titration lab").id);',
    ),
  );
  await shot("calendar", view("dark", '"calendar"', 'set({ calendar: { ...s().calendar, view: "week" } });'));
  await shot("calendar-light", view("light", '"calendar"', 'set({ calendar: { ...s().calendar, view: "week" } });'));
  await shot("calendar-month", view("dark", '"calendar"', 'set({ calendar: { ...s().calendar, view: "month" } });'));
  await shot("matrix", view("dark", '"matrix"'));
  await shot("matrix-light", view("light", '"matrix"'));
  await shot("habits", view("dark", '"habits"'));
  await shot("focus", view("dark", '"focus"'));
  await shot("stats", view("dark", '"stats"'));
} finally {
  await browser.close();
  await server.close();
}
