import { Bell, ChevronLeft, ChevronRight, Database, Info, LifeBuoy, type LucideIcon, Mic, Palette, Search, Settings2, Wrench } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { Switch } from "../../components/ui/Switch";
import { Segmented } from "../../components/ui/Segmented";
import { AboutSection, DataSection } from "./DataSection";
import { NotificationSection } from "./NotificationSection";
import { SoundsSection } from "./SoundsSection";
import { UpdatesSection } from "./UpdatesSection";
import { VoiceSection } from "./VoiceSection";
import { keyLabel } from "../../lib/platform";
import { VOICE_SECTION_ID } from "../../lib/voice";
import { TagsSection } from "./TagsSection";
import { HelpSection } from "../help/HelpSection";
import { HELP_SECTION_ID } from "../help/featureIcons";
import { LayoutPicker } from "./LayoutPicker";
import { ACCENTS, type AccentId } from "../../domain/color";
import { SCALE_MAX, SCALE_MIN, SCALE_STEP, type Settings, type ViewId } from "../../domain/types";
import { saveWorkspace } from "../../db/repo";
import { hydrate } from "../../stores/data";
import { hydrateFocus, saveSessions } from "../../stores/focus";
import { hydrateHabits, saveHabitData } from "../../stores/habits";
import { openSettingsPage, useSettings, useSettingsPage } from "../../stores/settings";
import { toast, useUi } from "../../stores/ui";
import { MODULE_NAV, SMART_LIST_NAV } from "../shell/nav";

/** One bordered card per page (D198); each direct child is a row with a hairline above it. */
function Card({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-card border border-border bg-surface [&>*]:px-3.5 [&>*]:py-3 [&>*+*]:border-t [&>*+*]:border-border">{children}</div>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="font-medium">{label}</span>
      {children}
    </div>
  );
}

function AccentPicker({ value, onChange }: { value: AccentId; onChange: (id: AccentId) => void }) {
  const swatch = "size-[22px] rounded-full swatch";
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Accent color">
      {ACCENTS.map((p) => (
        <button
          key={p.id}
          type="button"
          title={p.name}
          aria-label={p.name}
          aria-pressed={p.id === value}
          onClick={() => onChange(p.id)}
          className={swatch}
          style={{ "--sw": p.light, "--sw-d": p.dark } as CSSProperties}
        >
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, text }: { checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <span className="flex items-center gap-2.5 text-[length:var(--fs-sm)] text-muted">
      {text}
      <Switch checked={checked} onChange={onChange} label={text} />
    </span>
  );
}

/** Click, then press a combination (Ctrl/Alt plus a key) to record it. */
function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  const label = keyLabel(value.replace("CommandOrControl", "Ctrl").split("+").join(" + "));
  return (
    <button
      type="button"
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        if (e.key === "Escape") return setRecording(false);
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
        if (!e.ctrlKey && !e.altKey && !e.metaKey) return;
        const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code;
        onChange([e.ctrlKey || e.metaKey ? "CommandOrControl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : "", key].filter(Boolean).join("+"));
        setRecording(false);
      }}
      className={`btn min-w-40 tabular-nums ${recording ? "border-accent-text bg-accent-soft text-fg" : "btn-secondary"}`}
    >
      {recording ? "Press keys…" : label}
    </button>
  );
}

const DEFAULT_VIEWS: { id: ViewId; label: string }[] = [...SMART_LIST_NAV, ...MODULE_NAV];

type Page = { id: string; title: string; icon: LucideIcon };
const PAGES: Page[] = [
  { id: "settings-general", title: "General", icon: Settings2 },
  { id: "settings-appearance", title: "Appearance", icon: Palette },
  { id: "settings-notifications", title: "Notifications & sounds", icon: Bell },
  { id: VOICE_SECTION_ID, title: "Voice", icon: Mic },
  { id: "settings-data", title: "Data", icon: Database },
  { id: HELP_SECTION_ID, title: "Help", icon: LifeBuoy },
  { id: "settings-about", title: "About & updates", icon: Info },
  ...(import.meta.env.DEV ? [{ id: "settings-developer", title: "Developer", icon: Wrench }] : []),
];
/** Pages the list shows together, like the groups on a phone's settings screen. */
const GROUPS = [["settings-general", "settings-appearance", "settings-notifications"], [VOICE_SECTION_ID, "settings-data"], [HELP_SECTION_ID, "settings-about"], ["settings-developer"]];

/** Searchable settings: [page, label as shown on that page]. The label is found in the page text to scroll to it. */
const INDEX: [string, string][] = [
  ["settings-general", "Start view"], ["settings-general", "Week starts on"], ["settings-general", "Time format"], ["settings-general", "Smart parsing in quick add"],
  ["settings-general", "Closing the window"], ["settings-general", "Launch at login"], ["settings-general", "Global quick add"], ["settings-general", "Mini window"], ["settings-general", "Tags"],
  ["settings-appearance", "Theme"], ["settings-appearance", "Accent"], ["settings-appearance", "Layout"], ["settings-appearance", "Sidebar position"], ["settings-appearance", "Animations"],
  ["settings-appearance", "Density"], ["settings-appearance", "Scale"],
  ["settings-notifications", "Notifications"], ["settings-notifications", "Task reminders"], ["settings-notifications", "When things start"], ["settings-notifications", "Habit reminders"],
  ["settings-notifications", "Daily summary"], ["settings-notifications", "Focus timer"], ["settings-notifications", "Style"], ["settings-notifications", "Popup position"], ["settings-notifications", "Chime"],
  ["settings-notifications", "Sound effects"], ["settings-notifications", "Volume"],
  [VOICE_SECTION_ID, "Voice model"], [VOICE_SECTION_ID, "Microphone"], [VOICE_SECTION_ID, "Push to talk"],
  ["settings-data", "Export backup"], ["settings-data", "Restore from backup"], ["settings-data", "Import calendar"],
  ["settings-about", "Check at launch"], ["settings-about", "Check now"],
];

/** The row whose label is `label`: the smallest element starting with that text, and the flex row around it. */
function findRow(root: HTMLElement, label: string): HTMLElement | null {
  const want = label.toLowerCase();
  const hit = [...root.querySelectorAll<HTMLElement>("span, div, button")].find((el) => el.children.length <= 1 && (el.textContent ?? "").trim().toLowerCase().startsWith(want) && (el.textContent ?? "").trim().length < want.length + 24);
  return hit ? (hit.closest<HTMLElement>("div.flex") ?? hit) : null;
}

function Group({ children }: { children: ReactNode }) {
  return <ul className="overflow-hidden rounded-card border border-border bg-surface [&>li+li]:border-t [&>li+li]:border-border">{children}</ul>;
}

function PageRow({ icon: Icon, title, hint, onClick }: { icon: LucideIcon; title: string; hint?: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex h-[var(--row)] w-full items-center gap-3 px-3.5 text-left hover:bg-surface-2">
        <span className="grid size-[1.625rem] shrink-0 place-items-center rounded-control bg-accent-soft text-accent-text">
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {hint && <span className="shrink-0 truncate text-[length:var(--fs-sm)] text-muted">{hint}</span>}
        <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
      </button>
    </li>
  );
}

export function SettingsView() {
  const s = useSettings((st) => st.settings);
  const update = useSettings((st) => st.update);
  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => update({ [key]: value });

  const page = useSettingsPage((st) => st.page);
  const [query, setQuery] = useState("");
  /** The label a search result led to; scrolled to and marked once its page is on screen. */
  const [target, setTarget] = useState<string | null>(null);
  const pane = useRef<HTMLDivElement>(null);
  const current = PAGES.find((p) => p.id === page) ?? null;
  const open = (id: string | null, label: string | null = null) => (openSettingsPage(id), setTarget(label), setQuery(""));

  // Leaving Settings returns to the category list next time. (Not on a React dev remount: the view is still Settings then.)
  useEffect(() => () => (useUi.getState().view !== "settings" ? openSettingsPage(null) : undefined), []);
  // Escape or Alt+Left go back (D202). Escape inside a field that handled it (the shortcut recorder) stays there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.key === "Escape" || (e.altKey && e.key === "ArrowLeft"))) return;
      if (query) return setQuery("");
      if (current) (e.preventDefault(), open(null));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    const root = pane.current;
    if (!root) return;
    const row = target && current ? findRow(root, target) : null;
    if (!row) return void root.scrollTo({ top: 0 });
    row.scrollIntoView({ block: "center" });
    row.classList.add("settings-hit");
    const t = setTimeout(() => row.classList.remove("settings-hit"), 1800);
    return () => (clearTimeout(t), row.classList.remove("settings-hit"));
  }, [page, target]);

  const q = query.trim().toLowerCase();
  const pageOf = (id: string) => PAGES.find((p) => p.id === id);
  const results = q
    ? [
        ...PAGES.filter((p) => p.title.toLowerCase().includes(q)).map((p) => ({ page: p.id, label: p.title, jump: null as string | null })),
        ...INDEX.filter(([id, label]) => label.toLowerCase().includes(q) && pageOf(id)).map(([id, label]) => ({ page: id, label, jump: label })),
      ]
    : [];

  const bodies: Record<string, ReactNode> = {
    "settings-general": (
      <Card>
        <Row label="Start view">
          <select
            value={s.defaultView}
            onChange={(e) => {
              const v = DEFAULT_VIEWS.find((d) => d.id === e.target.value);
              if (v) update({ defaultView: v.id });
            }}
            className="input w-auto"
          >
            {DEFAULT_VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Week starts on">
          <Segmented
            name="weekStart"
            label="Week starts on"
            value={s.weekStart}
            onChange={set("weekStart")}
            options={[
              { value: 1, label: "Monday" },
              { value: 0, label: "Sunday" },
              { value: 6, label: "Saturday" },
            ]}
          />
        </Row>
        <Row label="Time format">
          <Segmented
            name="timeFormat"
            label="Time format"
            value={s.timeFormat}
            onChange={set("timeFormat")}
            options={[
              { value: "12h", label: "1:30 PM" },
              { value: "24h", label: "13:30" },
            ]}
          />
        </Row>
        <Row label="Smart parsing in quick add">
          <Toggle checked={s.smartParse} onChange={(v) => update({ smartParse: v })} text="Detect dates, !priority, #tags, ~lists" />
        </Row>
        <Row label="Completed tasks">
          <Toggle checked={s.showCompleted} onChange={(v) => update({ showCompleted: v })} text="Show completed tasks" />
        </Row>
        <Row label="Closing the window">
          <Toggle checked={s.closeToTray} onChange={(v) => update({ closeToTray: v })} text="Keep running in the tray" />
        </Row>
        <Row label="Launch at login">
          <Toggle checked={s.launchAtStartup} onChange={(v) => update({ launchAtStartup: v })} text="Start minimized to the tray" />
        </Row>
        <Row label="Global quick add">
          <ShortcutInput value={s.quickAddShortcut} onChange={(v) => (v === s.voiceShortcut ? toast("That shortcut is already push-to-talk.") : update({ quickAddShortcut: v }))} />
        </Row>
        <Row label="Mini window">
          <ShortcutInput value={s.miniShortcut} onChange={(v) => update({ miniShortcut: v })} />
        </Row>
        <div className="space-y-2">
          <span className="font-medium">Tags</span>
          <TagsSection />
        </div>
      </Card>
    ),
    "settings-appearance": (
      <Card>
        <Row label="Theme">
          <Segmented
            name="theme"
            label="Theme"
            value={s.theme}
            onChange={set("theme")}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </Row>
        <Row label="Accent">
          <AccentPicker value={s.accent} onChange={set("accent")} />
        </Row>
        <div className="space-y-3">
          <span className="block font-medium">Layout</span>
          <LayoutPicker />
        </div>
        {s.layout === "sidebar" && (
          <Row label="Sidebar position">
            <Segmented
              name="sidebarSide"
              label="Sidebar position"
              value={s.sidebarSide}
              onChange={set("sidebarSide")}
              options={[
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ]}
            />
          </Row>
        )}
        <Row label="Animations">
          <Segmented
            name="motion"
            label="Animations"
            value={s.motion}
            onChange={set("motion")}
            options={[
              { value: "system", label: "System" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
        </Row>
        <Row label="Density">
          <Segmented
            name="density"
            label="Density"
            value={s.density}
            onChange={set("density")}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </Row>
        <Row label="Scale">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={SCALE_MIN}
              max={SCALE_MAX}
              step={SCALE_STEP}
              value={s.scale}
              aria-label="Scale"
              aria-valuetext={`${Math.round(s.scale * 100)}%`}
              onChange={(e) => set("scale")(Number(e.target.value))}
              className="w-48 accent-[var(--accent)]"
            />
            <span className="w-10 text-right tabular-nums">{Math.round(s.scale * 100)}%</span>
          </div>
        </Row>
      </Card>
    ),
    "settings-notifications": (
      <Card>
        <NotificationSection />
        <SoundsSection />
      </Card>
    ),
    [VOICE_SECTION_ID]: (
      <Card>
        <VoiceSection />
        <Row label="Push to talk">
          <ShortcutInput value={s.voiceShortcut} onChange={(v) => (v === s.quickAddShortcut ? toast("That shortcut already opens quick add.") : update({ voiceShortcut: v }))} />
        </Row>
        <p className="text-[length:var(--fs-sm)] text-muted">Hold the shortcut, say a task, let go, then press Enter. Or say “start focus”, “stop focus”, “open today”, “show matrix”, “show completed” or “open calendar”.</p>
      </Card>
    ),
    "settings-data": (
      <Card>
        <DataSection />
      </Card>
    ),
    [HELP_SECTION_ID]: (
      <Card>
        <HelpSection />
      </Card>
    ),
    "settings-about": (
      <Card>
        <UpdatesSection />
        <AboutSection />
      </Card>
    ),
    "settings-developer": (
      <Card>
        <Row label="Sample data">
          <button
            type="button"
            onClick={async () => {
              const seed = await import("../../dev/seed");
              const ws = seed.sampleWorkspace();
              await saveWorkspace(ws);
              await saveHabitData(seed.sampleHabits());
              await saveSessions(seed.sampleFocus(ws.tasks));
              await Promise.all([hydrate(), hydrateHabits(), hydrateFocus()]);
              toast("Sample data loaded");
            }}
            className="btn btn-secondary"
          >
            Load sample data
          </button>
        </Row>
      </Card>
    ),
  };

  return (
    <div ref={pane} className="h-full min-h-0 overflow-y-auto">
      {/* Keyed by page, so each one slides in from the side it comes from (D208). */}
      <div key={current?.id ?? "home"} data-dir={current ? "fwd" : "back"} className="anim-page mx-auto flex max-w-[640px] flex-col gap-5 px-[var(--gutter)] py-8">
        {current ? (
          <>
            <button type="button" onClick={() => open(null)} className="btn btn-ghost -ml-2 w-fit self-start text-accent-text">
              <ChevronLeft size={16} aria-hidden /> Settings
            </button>
            <PageHead title={current.title} />
            {bodies[current.id]}
          </>
        ) : (
          <>
            <PageHead title="Settings" />
            <label className="relative block">
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings" aria-label="Search settings" className="input pl-9" />
            </label>
            {q ? (
              results.length ? (
                <Group>
                  {results.map((r) => (
                    <PageRow key={`${r.page}:${r.label}`} icon={pageOf(r.page)?.icon ?? Settings2} title={r.label} hint={r.jump ? pageOf(r.page)?.title : undefined} onClick={() => open(r.page, r.jump)} />
                  ))}
                </Group>
              ) : (
                <p className="py-6 text-center text-muted">No settings match “{query.trim()}”.</p>
              )
            ) : (
              GROUPS.map((ids) => {
                const pages = ids.flatMap((id) => PAGES.filter((p) => p.id === id));
                return (
                  pages.length > 0 && (
                    <Group key={ids[0]}>
                      {pages.map((p) => (
                        <PageRow key={p.id} icon={p.icon} title={p.title} onClick={() => open(p.id)} />
                      ))}
                    </Group>
                  )
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
